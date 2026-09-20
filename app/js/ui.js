/* ──────────────────────────────────────────────────────────────
   Abbey Road · 界面主体
   外壳导航 / 布局引擎（三预设 + 拖拽 + 聚焦态）/ 今日页 / 周表 / 毛玻璃弹窗
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  var U = null;
  var S = null;
  var cursorDate = new Date();
  var currentView = 'today';
  var weekCursor = null;   // 周表当前周次
  var weekDaySel = null;   // 窄屏周表选中的星期（1-7）
  var weekPageMode = 'week';   // 周表页：week | month
  var weekMonthCursor = null;  // 周表页月视图：当前月份

  function $(id) { return document.getElementById(id); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  /* ── 布局引擎 ─────────────────────────────────────────────── */

  var Layout = {
    el: null,
    preset: 'triple-horizontal',
    expanded: null,          // null | 'week' | 'today' | 'next'
    profileKey: 'wide',
    profiles: null
  };

  var monthCursor = null;    // 月视图当前月份（Date，取每月 1 号）
  var weekZoneMode = 'week'; // 展开本周概览时的视图：week | month
  var conflictOpen = false;  // 周表页「冲突检测」是否展开
  var lastTodayKey = '';     // 上次渲染时「今天」是哪天，用于跨天/回前台时自动翻页
  var nextState = null;      // 「最近的课」当前画的是哪一节（倒计时定时刷新用）
  var nextTickTimer = null;  // 「最近的课」刷新定时器
  var lastPointer = { x: 0, y: 0 };   // 最近一次点按位置（「点击处扩散」这种以手势为原点的动画要用）

  document.addEventListener('pointerdown', function (ev) {
    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
  }, true);

  /**
   * 尺寸一律用「占比（%）」而不再是像素。
   * 早期版本写死 px，在窄屏手机上会把另一栏挤成一条竖缝（文字竖排、错位），
   * 改成比例后任何屏幕宽度都不会塌陷，设置里的滑块也直接显示百分比。
   *
   *   triple-horizontal：week.w / next.w = 左右两栏的宽度占比
   *   dual-horizontal  ：next.w = 右侧「最近的课」宽度占比，week.h = 左上「本周概览」高度占比
   *   stacked-vertical ：week.h / next.h = 上下两栏的高度占比
   */
  var DEFAULT_PROFILES = {
    wide: { preset: 'dual-horizontal', week: { w: 34, h: 32 }, next: { w: 34, h: 34 } },
    medium: { preset: 'dual-horizontal', week: { w: 34, h: 32 }, next: { w: 40, h: 34 } },
    // 直板手机默认「左右」布局（左上：本周概览，左下：今日日程，右侧：最近的课）
    narrow: { preset: 'dual-horizontal', week: { w: 36, h: 30 }, next: { w: 44, h: 34 } }
  };

  function breakpointKey(w) {
    if (w >= 1024) { return 'wide'; }
    if (w >= 720) { return 'medium'; }
    return 'narrow';
  }

  function loadProfiles() {
    var raw = null;
    try { raw = localStorage.getItem(AR.Const.LAYOUT_KEY); } catch (e) { raw = null; }
    var p = raw ? JSON.parse(raw) : {};
    var out = {};
    var keys = ['wide', 'medium', 'narrow'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var base = U.deepCopy(DEFAULT_PROFILES[k]);
      if (p && p[k]) {
        // v0.1.8 起只有「左右 / 上中下」两种布局，旧的 auto / 左中右一律折算成「左右」
        if (p[k].preset) {
          base.preset = (p[k].preset === 'stacked-vertical') ? 'stacked-vertical' : 'dual-horizontal';
        }
        // 旧版本存的是像素（~200–400），比 90 大的值一律视为旧数据并回落到默认百分比
        if (p[k].week) {
          base.week = { w: asPercent(p[k].week.w, base.week.w), h: asPercent(p[k].week.h, base.week.h) };
        }
        if (p[k].next) {
          base.next = { w: asPercent(p[k].next.w, base.next.w), h: asPercent(p[k].next.h, base.next.h) };
        }
      }
      out[k] = base;
    }
    return out;
  }

  /** 把存的尺寸归一化成百分比：非法值 / 旧像素值都用默认值顶替 */
  function asPercent(v, fallback) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) { return fallback; }
    if (n > 90) { return fallback; }        // 旧版像素值
    return Math.round(U.clamp(n, 10, 90));
  }

  function saveProfiles() {
    try { localStorage.setItem(AR.Const.LAYOUT_KEY, JSON.stringify(Layout.profiles)); } catch (e) { }
  }

  function resolvedPreset() {
    // v0.1.8：设置里只有「左右」与「上中下」两种，旧的 auto / 左中右都折算成「左右」
    var pref = (S.settings.layout && S.settings.layout.preset) || 'dual-horizontal';
    return (pref === 'stacked-vertical') ? 'stacked-vertical' : 'dual-horizontal';
  }

  function sizeOf(which) {
    return Layout.profiles[Layout.profileKey][which];
  }

  /**
   * 按「期望高度」分配纵向空间：保证每栏不低于最小值，总和等于 total，
   * 富余空间给弹性栏（通常是「今日日程」）。
   */
  function fitSizes(total, wants, mins, elastic) {
    var n = wants.length;
    var w = wants.slice(0);
    var sum = 0, i;
    for (i = 0; i < n; i++) { sum += w[i]; }
    if (sum > total) {
      var slack = 0;
      for (i = 0; i < n; i++) { slack += Math.max(0, w[i] - mins[i]); }
      var over = sum - total;
      if (slack > 0) {
        for (i = 0; i < n; i++) {
          var can = Math.max(0, w[i] - mins[i]);
          if (can > 0) { w[i] -= over * (can / slack); }
        }
      }
      var s2 = 0;
      for (i = 0; i < n; i++) { s2 += w[i]; }
      if (s2 > total && s2 > 0) {
        var k = total / s2;
        for (i = 0; i < n; i++) { w[i] = Math.max(64, w[i] * k); }
      }
    } else if (sum < total) {
      var idx = (elastic == null ? n - 1 : elastic);
      w[idx] += (total - sum);
    }
    var out = [];
    for (i = 0; i < n; i++) { out.push(Math.round(w[i])); }
    return out;
  }

  /**
   * 把百分比切成像素，最后一段吃掉取整误差，保证总和精确等于 total。
   */
  function pctParts(total, list) {
    var out = [], used = 0, i;
    for (i = 0; i < list.length - 1; i++) {
      out.push(Math.max(0, Math.round(total * list[i] / 100)));
      used += out[i];
    }
    out.push(Math.max(0, total - used));
    return out;
  }

  /**
   * 算出三栏的像素矩形 {x, y, w, h}。
   *
   * 为什么改回 px：
   *   ① 浏览器不能补间 grid 轨道。之前为了"看起来在放大"，只能对整栏做
   *      transform: scale()，实测最夸张的一帧是 scale(2.06, 0.64)——
   *      面板和文字一起被横向拉长、纵向压扁，观感诡异，栅格化还特别贵。
   *   ② 矩形在 JS 手里，"展开"就只是三个矩形换个位置。补间 left/top/width/height
   *      时文字始终按最终宽度排版，只会自然重排，不会被拉伸变形。
   * 占比来源仍然是设置里的滑块（百分比），所以窄屏、折叠屏、平板都是同一套规则。
   */
  function rectsFor(preset, ex, p, W, H) {
    var gap = Layout.gap;
    var out = {};

    if (preset === 'stacked-vertical') {
      // 上中下：三行，行间距有两条
      var ch = Math.max(60, H - gap * 2);
      var t = U.clamp(Number(p.week.h) || 30, 14, 62);
      var b = U.clamp(Number(p.next.h) || 30, 14, 62);
      if (!ex && t + b > 78) { var kb = 78 / (t + b); t *= kb; b *= kb; }
      var mid = 100 - t - b;
      if (ex === 'week') { t = 56; mid = 26; b = 18; }
      else if (ex === 'today') { t = 16; mid = 66; b = 18; }
      else if (ex === 'next') { t = 16; mid = 26; b = 58; }
      var hs = pctParts(ch, [t, mid, b]);
      out.week = { x: 0, y: 0, w: W, h: hs[0] };
      out.today = { x: 0, y: hs[0] + gap, w: W, h: hs[1] };
      out.next = { x: 0, y: hs[0] + hs[1] + gap * 2, w: W, h: hs[2] };
      return out;
    }

    // 左右（默认）：右侧「最近的课」上下通高，左上「本周概览」+ 左下「今日日程」
    var cw = Math.max(60, W - gap);
    var chh = Math.max(60, H - gap);
    /**
     * 右侧那栏给一个像素下限：窄屏（360–420dp 的直板机）上按百分比算只有
     * 150–180px，卡片里的字会一个词一行。这里保证它至少 MIN_R 宽，
     * 屏幕够宽时仍然完全按设置里的滑杆走。
     */
    var MIN_R = 196;
    var right = U.clamp(Number(p.next.w) || 38, 26, 62);
    if (W > 0 && W * right / 100 < MIN_R) {
      right = U.clamp(Math.round(MIN_R / W * 100), 26, 56);
    }
    var left = 100 - right;
    if (ex === 'week' || ex === 'today') { left = 70; right = 30; }
    else if (ex === 'next') { left = 32; right = 68; }
    var ws = pctParts(cw, [left, right]);
    var top = U.clamp(Number(p.week.h) || 32, 14, 72);
    var rows = [top, 100 - top];
    if (ex === 'week') { rows = [74, 26]; }
    else if (ex === 'today') { rows = [27, 73]; }
    else if (ex === 'next') { rows = [50, 50]; }
    var hs2 = pctParts(chh, rows);
    out.week = { x: 0, y: 0, w: ws[0], h: hs2[0] };
    out.today = { x: 0, y: hs2[0] + gap, w: ws[0], h: hs2[1] };
    out.next = { x: ws[0] + gap, y: 0, w: ws[1], h: H };
    return out;
  }

  /**
   * 展开态下，另外两栏里哪些要切成 compact（只留一行摘要）。
   *
   * 规则：被挤到"放不下完整内容"的宽度就 compact。
   * 早期版本只看预设不看宽度，结果直板手机上「本周概览」一展开，右侧
   * 「最近的课」只剩 30%（约 120px），卡片里的字一个一行，看起来就是排版错乱。
   * 现在按实际像素判断：够宽（平板/桌面）保留完整内容，不够宽就只留一行摘要。
   */
  function compactZones(ex, preset, availW) {
    var out = { week: false, today: false, next: false };
    if (!ex) { return out; }
    var W = Number(availW) || (Layout.el ? Layout.el.clientWidth : 1200) || 1200;
    var NEED = 250;                 // 完整内容至少需要的宽度（含内边距）
    if (preset === 'stacked-vertical') {
      out.week = (ex !== 'week');
      out.today = (ex !== 'today');
      out.next = (ex !== 'next');
      return out;
    }
    out.week = (ex !== 'week');
    out.today = (ex !== 'today');
    // 左右布局：右栏在"别人展开"时只有 30%，自己展开时是 68%
    var rightPct = (ex === 'next') ? 68 : 30;
    out.next = (ex !== 'next') && (W * rightPct / 100 < NEED);
    return out;
  }

  /**
   * 应用布局：算出目标矩形 → 打标记 → 要么直接落位，要么补间过去。
   * 矩形来源只有一个（rectsFor），所以滑块微调、预设切换、聚焦放大
   * 走的是同一条路径，不会出现"某条路径忘了同步"的错位。
   */
  function applyLayout(animate) {
    var el = Layout.el;
    if (!el) { return; }
    /**
     * 栏间距跟着视口走：窄屏 10px、中等 12px、宽屏 14px。
     * 以前是读一次 CSS 变量就缓存，改成按宽度实时算并写回变量，
     * 这样 JS 算矩形和 CSS 的观感永远一致（旋转屏幕 / 折叠展开都不会错位）。
     */
    var vw = document.documentElement.clientWidth || window.innerWidth || 0;
    Layout.gap = vw && vw < 560 ? 10 : (vw && vw < 900 ? 12 : 14);
    el.style.setProperty('--layout-gap', Layout.gap + 'px');
    var preset = resolvedPreset();
    Layout.preset = preset;
    var p = Layout.profiles[Layout.profileKey];
    var ex = Layout.expanded;

    var W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) { return; }                    // 视图隐藏时量不到尺寸，等下次 show()
    var target = rectsFor(preset, ex, p, W, H);

    el.setAttribute('data-preset', preset);
    el.setAttribute('data-expand', ex || 'none');

    updateZoneClasses(ex, preset);
    applyZoneWidthClasses(target);

    /**
     * 补间的起点要用"此刻真实画在哪"：
     * 连续快点时上一段动画可能只播到一半，如果拿 Layout.rects（上一次的
     * 目标值）当起点，画面会瞬间跳一下再继续。这里只有需要动画时才去读一次
     * 真实位置（4 次布局读取，一次点击的代价可以接受）。
     */
    var from = animate ? currentRects() : Layout.rects;
    Layout.rects = target;
    if (animate && from && from.week && target.week && from.next && target.next) {
      morphRects(from, target, { collapse: !ex, expandKey: ex });
    } else {
      setRects(target);
    }
  }

  /**
   * 按"每一栏自己的内容宽度"打档位（w-xs / w-s / w-m / w-l / w-xl）。
   *
   * 为什么不用容器查询：Android 12 时代不少机器的 WebView 还停在
   * Chrome 101（我们手上这台模拟器就是 101），@container 完全不支持。
   * 矩形本来就是 JS 算的，顺手打个类，CSS 里按类调字号/内边距最稳，
   * 而且聚焦放大后"栏变宽 → 档位升级"也是同一套逻辑。
   */
  function applyZoneWidthClasses(rects) {
    var pad = null;
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var z = $(ZONE_IDS[k]);
      var r = rects[k];
      if (!z || !r) { continue; }
      if (pad == null) { pad = parseFloat(getComputedStyle(z).paddingLeft) || 14; }
      var content = Math.max(0, r.w - 2 - pad * 2);
      var cls = content < 190 ? 'w-xs'
        : (content < 300 ? 'w-s'
          : (content < 470 ? 'w-m'
            : (content < 700 ? 'w-l' : 'w-xl')));
      var all = ['w-xs', 'w-s', 'w-m', 'w-l', 'w-xl'];
      for (var i = 0; i < all.length; i++) {
        if (all[i] === cls) { z.classList.add(cls); } else { z.classList.remove(all[i]); }
      }
    }
  }

  /** 读三栏"此刻真实"的布局矩形（含正在播放的补间），用于 FLIP 式接续动画 */
  function currentRects() {
    var host = Layout.el;
    if (!host) { return null; }
    var base = host.getBoundingClientRect();
    var out = {};
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var node = $(ZONE_IDS[k]);
      if (!node) { continue; }
      var r = node.getBoundingClientRect();
      out[k] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    }
    return out;
  }

  /** 展开 / 收起 / compact 这些状态标记 + 栏头按钮图标 */
  function updateZoneClasses(ex, preset) {
    var compactMap = compactZones(ex, preset);
    var zones = { week: $('zoneWeek'), today: $('zoneToday'), next: $('zoneNext') };
    for (var key in zones) {
      if (!Object.prototype.hasOwnProperty.call(zones, key)) { continue; }
      var z = zones[key];
      if (!z) { continue; }
      var isOpen = (ex === key);
      z.classList.toggle('expanded', isOpen);
      z.classList.toggle('dimmed', !!ex && !isOpen && !!compactMap[key]);
      z.classList.toggle('compact', !!compactMap[key]);
      z.style.setProperty('--fs-scale', isOpen ? '1.06' : '1');
      var btn = z.querySelector('.zone-toggle');
      if (btn) { btn.textContent = isOpen ? '✕' : '⤢'; }
    }
  }

  /** 取某一栏里的毛玻璃层（.zone-glass，负责所有模糊与底色） */
  function glassOf(node) {
    var k = node && node.firstElementChild;
    return (k && k.classList && k.classList.contains('zone-glass')) ? k : null;
  }

  /** 把矩形直接写到 DOM 上（无动画路径：首帧、窗口尺寸变化、滑块拖动） */
  function setRects(rects) {
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var node = $(ZONE_IDS[k]);
      var r = rects[k];
      if (!node || !r) { continue; }
      setRectsOne(node, r);
    }
  }

  /**
   * 展开 / 收起时的内容过渡：几何在长大，内容"浮"进去。
   * 只在 .zone-body 上动 opacity / transform —— 这一层没有毛玻璃，
   * 所以不会触发重排、也不会让 backdrop-filter 重算。
   * 用 WAAPI 而不是 CSS 类，连续点击时能稳定重播，也不会留下"半透明残留"。
   */
  function playZoneContent(next) {
    var speed = Number((S.settings.appearance && S.settings.appearance.animationSpeed) || 1) || 1;
    var style = AR.Motion ? AR.Motion.get('contentIn') : null;
    var zStyle = AR.Motion ? AR.Motion.dir('zoneFocus', next ? 'in' : 'out') : null;
    // 特效可以挂在"聚焦放大"样式上，也可以挂在"卡片内容"样式上（磁贴翻转两者都提供）
    var fx = (next && style && style.fx) || (zStyle && zStyle.fx);
    var skipFade = (style && !style.dur) || (zStyle && zStyle.content === 'none');
    if (skipFade && !fx) { return; }                 // 既不要淡入也没有特效 → 什么也不做
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var node = $(ZONE_IDS[k]);
      if (!node) { continue; }
      var body = node.querySelector('.zone-body');
      if (!body || !body.animate) { continue; }
      if (body.__cAnim) { try { body.__cAnim.cancel(); } catch (e) { } body.__cAnim = null; }
      var isNext = (k === next);
      if (isNext && fx) { playContentFx(body, fx, zStyle, speed); }
      if (skipFade) { continue; }
      /**
       * 关键帧里 opacity 先冲到 1（默认 45% 处），剩下的时间只留给位移/缩放收尾：
       * 这样内容不会在整段动画里一直半透明 —— "内容淡入太慢"看起来像蒙了一层灰。
       * 具体位移/缩放/时长由 AR.Motion 的 contentIn 样式决定（开发者模式可换）。
       */
      var m = style || { dur: isNext ? 300 : 220, ease: 'expo', y: 10, s: .986, hold: .45, x: 0 };
      var y = isNext ? (m.y || 0) : Math.min(m.y || 0, 4);
      var sc = isNext ? (m.s == null ? 1 : m.s) : 1;
      var hold = m.hold == null ? .5 : m.hold;
      var startOp = isNext ? .35 : .6;
      var frames = (sc === 1 && !y && !(m.x || 0))
        ? [{ opacity: startOp, offset: 0 }, { opacity: 1, offset: hold }, { opacity: 1, offset: 1 }]
        : [{ opacity: startOp, transform: 'translate3d(' + (m.x || 0) + 'px,' + y + 'px,0) scale(' + sc + ')', offset: 0 },
           { opacity: 1, transform: 'translate3d(0px,0px,0) scale(1)', offset: hold },
           { opacity: 1, transform: 'none', offset: 1 }];
      body.__cAnim = body.animate(frames, {
        duration: Math.round((isNext ? m.dur : Math.min(m.dur, 240)) / speed),
        delay: isNext ? 30 : 0,
        easing: AR.Motion ? AR.Motion.ease(m.ease) : 'cubic-bezier(.16,1,.30,1)',
        fill: 'none'
      });
      body.__cAnim.onfinish = (function (b) { return function () { b.__cAnim = null; }; })(body);
    }
  }

  /**
   * 内容层的"大胆"特效（都用合成友好的 transform / opacity / filter）。
   *
   *   flipY      磁贴翻转：整层绕 Y 轴翻进来（微软 Live Tile 的观感）
   *   foldX      折纸展开：整层从上边缘翻开
   *   depth      景深推移：从放大 + 模糊推到清晰
   *   ripple     点击处扩散：以点按位置为原点放大展开
   *   spotlight  聚光显影：从过曝模糊收到清晰
   *   cascade    瀑布逐条：卡片一条条落下
   *   mosaic     磁贴拼合：卡片一块块拼上（带轻微旋转）
   *   带 Out 后缀的是收起方向
   */
  function playContentFx(body, fx, style, speed) {
    var dur = Math.round((style.fxDur || 440) / speed);
    var stagger = Math.round((style.fxStagger || 55) / speed);
    var ease = AR.Motion ? AR.Motion.ease(style.ease) : 'cubic-bezier(.2,.8,.2,1)';
    var kids, i, k;

    /**
     * 磁贴翻转的关键：**轴放在你点的那个位置所在的那条边**。
     * 点右半屏 → 以右边缘为轴，从右往左翻进来；点左半屏则相反。
     * 再加上一点点缩放，读起来就是"从我点的卡片翻开、放大成这一栏"。
     */
    function hingeSide() {
      var r = body.getBoundingClientRect();
      if (!r.width) { return 'right'; }
      var px = (lastPointer.x || 0) - r.left;
      // 没有有效点按位置时（键盘回车 / 脚本触发）：按这一栏在屏幕上的左右位置猜
      if (px < -4 || px > r.width + 4) {
        return (r.left + r.width / 2) >= (window.innerWidth / 2) ? 'right' : 'left';
      }
      return px < r.width / 2 ? 'left' : 'right';
    }

    if (fx === 'cascade' || fx === 'mosaic') {
      kids = body.querySelectorAll('.strip, .info-cell, .next-hero, .card, .zone-compact, .ev-strip, .zone-tools');
      for (i = 0; i < kids.length; i++) {
        k = kids[i];
        if (!k.animate) { continue; }
        if (k.__fx) { try { k.__fx.cancel(); } catch (e) { } k.__fx = null; }
        var from = (fx === 'cascade')
          ? { opacity: 0, transform: 'translate3d(0,-24px,0)' }
          : { opacity: 0, transform: 'translate3d(0,16px,0) scale(.86) rotate(-2deg)' };
        k.__fx = k.animate([from, { opacity: 1, transform: 'none' }], {
          duration: dur, delay: i * (stagger || 55), easing: ease, fill: 'backwards'
        });
      }
      return;
    }

    var frames = null;
    var origin = 'center';
    if (fx === 'flipY') {
      origin = 'center';
      frames = [{ opacity: .15, transform: 'perspective(1100px) rotateY(-88deg)' }, { opacity: 1, transform: 'none' }];
    } else if (fx === 'flipYOut') {
      frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'perspective(1100px) rotateY(72deg)' }];
    } else if (fx === 'foldX') {
      origin = 'center top';
      frames = [{ opacity: .2, transform: 'perspective(1100px) rotateX(-78deg)' }, { opacity: 1, transform: 'none' }];
    } else if (fx === 'foldXOut') {
      origin = 'center top';
      frames = [{ opacity: 1, transform: 'none' }, { opacity: .15, transform: 'perspective(1100px) rotateX(64deg)' }];
    } else if (fx === 'depth') {
      frames = [{ opacity: .2, filter: 'blur(12px)', transform: 'scale(1.07)' }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }];
    } else if (fx === 'depthOut') {
      frames = [{ opacity: 1, filter: 'blur(0px)', transform: 'none' }, { opacity: .2, filter: 'blur(10px)', transform: 'scale(.94)' }];
    } else if (fx === 'spotlight') {
      frames = [{ opacity: 0, filter: 'blur(16px) brightness(1.8)', transform: 'scale(1.02)' },
                { opacity: 1, filter: 'blur(0px) brightness(1)', offset: .7 },
                { opacity: 1, filter: 'none', transform: 'none' }];
    } else if (fx === 'ripple') {
      var r = body.getBoundingClientRect();
      origin = Math.round(lastPointer.x - r.left) + 'px ' + Math.round(lastPointer.y - r.top) + 'px';
      frames = [{ opacity: .25, transform: 'scale(.82)' }, { opacity: 1, transform: 'none' }];
    } else if (fx === 'hingeFlip' || fx === 'hingeFlipOut') {
      var side = hingeSide();
      origin = (side === 'left' ? '0%' : '100%') + ' 50%';
      var sign = (side === 'left' ? 1 : -1);
      frames = (fx === 'hingeFlip')
        ? [{ opacity: .18, transform: 'perspective(760px) rotateY(' + (sign * 96) + 'deg) scale(.94)' },
           { opacity: 1, transform: 'perspective(760px) rotateY(0deg) scale(1.005)', offset: .72 },
           { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' },
           { opacity: .18, transform: 'perspective(760px) rotateY(' + (sign * 88) + 'deg) scale(.95)' }];
    } else if (fx === 'axialZ') {
      // 共享轴：像"进入下一层"，内容从远处推近
      frames = [{ opacity: 0, transform: 'perspective(1200px) translate3d(0,0,-260px) scale(.9)' },
                { opacity: 1, transform: 'none' }];
    } else if (fx === 'axialZOut') {
      frames = [{ opacity: 1, transform: 'none' },
                { opacity: 0, transform: 'perspective(1200px) translate3d(0,0,180px) scale(1.06)' }];
    }
    if (!frames) { return; }
    if (body.__fx) { try { body.__fx.cancel(); } catch (e) { } body.__fx = null; }
    body.style.transformOrigin = origin;
    body.__fx = body.animate(frames, { duration: dur, easing: ease, fill: 'none' });
    body.__fx.onfinish = (function (b) {
      return function () { b.__fx = null; b.style.transformOrigin = ''; };
    })(body);
  }

  /** 切换布局预设（带一次轻量淡入，避免"跳版"） */
  function setPreset(name, silent) {
    S.settings.layout.preset = name;
    AR.Store.save();
    if (name !== 'auto') {
      Layout.profiles[Layout.profileKey].preset = name;
      saveProfiles();
    }
    // 预设切换也走同一套矩形补间：换布局是"长大/收缩"，不是整块闪一下
    applyLayout(true);
    AR.UI.renderSettings();
    if (!silent) { AR.Bridge.haptic('light', false); }
  }

  function setSize(which, axis, value) {
    var p = Layout.profiles[Layout.profileKey];
    p[which][axis] = Math.round(U.clamp(value, 10, 90));
    saveProfiles();
    applyLayout(false);          // 拖滑块要跟手，不做补间
  }

  /**
   * 展开/收起某一栏（'week' | 'today' | 'next' | null）。
   * 展开的栏会放大细化，另外两栏同时缩小简略。
   *
   * 顺序很重要：先换内容 → 再从旧矩形补间到新矩形 → 最后让内容浮入。
   * 这样点击那一帧里没有任何"半成品"被画出来（同一帧内的改动不会被合成）。
   */
  function setExpanded(zone) {
    if (Layout.expanded === zone) { zone = null; }   // 再点一次同一栏 = 收起
    Layout.expanded = zone;
    document.body.setAttribute('data-expand', zone || 'off');
    // 视觉脉冲（scale）会和几何补间抢同一个元素，导致头 140ms 动画被顶掉、随后突然跳一下。
    // 这里只保留震动 / 提示音，视觉反馈交给放大动画本身。
    AR.Bridge.haptic(zone ? 'medium' : 'light', false);
    updateZoneClasses(zone, Layout.preset);
    renderToday();                    // 先把内容换成新状态
    applyLayout(true);                // 三栏矩形非线性补间
    playZoneContent(zone);            // 内容浮入（纯 opacity / transform）
  }

  var ZONE_IDS = { week: 'zoneWeek', today: 'zoneToday', next: 'zoneNext' };

  function sameRect(a, b) {
    return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
      && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
  }

  /**
   * 收尾：取消补间、解冻内容层、把玻璃层收回 inset:0 的自然状态。
   * 所有「取消 / 结束 / 被新动画打断」的路径都必须走这里，
   * 否则会留下一个被固定尺寸的内容层，下次排班就错位了。
   */
  function clearMorph(node) {
    if (!node) { return; }
    if (node.__morph) { try { node.__morph.cancel(); } catch (e) { } node.__morph = null; }
    if (node.__frozenInner) {
      var f = node.__frozenInner;
      node.__frozenInner = null;
      f.style.position = '';
      f.style.left = '';
      f.style.top = '';
      f.style.width = '';
      f.style.height = '';
      f.style.flex = '';
    }
    var gl = glassOf(node);
    if (gl && gl.__glassAnim) {
      try { gl.__glassAnim.cancel(); } catch (e) { }
      gl.__glassAnim = null;
    }
  }

  /**
   * 把内容层按"最终尺寸"钉住。
   *
   * 这是"框在长、字在跳"的根治办法：内容一次性按最终宽度排好版，
   * 动画期间它一动不动，只是被父级的 overflow:hidden 一点点露出来。
   * left/top 用栏自身的内边距，所以解冻后和正常流量布局完全对齐（不会跳）。
   */
  function freezeInner(node, rect) {
    var inner = node.querySelector ? node.querySelector('.zone-inner') : null;
    if (!inner) { return; }
    var cs = getComputedStyle(node);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padT = parseFloat(cs.paddingTop) || 0;
    var bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    var bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    inner.style.position = 'absolute';
    inner.style.left = padL + 'px';
    inner.style.top = padT + 'px';
    inner.style.width = Math.max(40, rect.w - bw - padL * 2) + 'px';
    inner.style.height = Math.max(40, rect.h - bh - padT * 2) + 'px';
    inner.style.flex = 'none';
    node.__frozenInner = inner;
  }

  /**
   * 单栏落位（无动画）：矩形 + 毛玻璃层 + 内容层都回到自然状态。
   */
  function setRectsOne(node, r) {
    clearMorph(node);
    node.style.left = r.x + 'px';
    node.style.top = r.y + 'px';
    node.style.width = r.w + 'px';
    node.style.height = r.h + 'px';
    var gl = glassOf(node);
    if (gl) {
      gl.style.left = '0px';
      gl.style.top = '0px';
      gl.style.width = r.w + 'px';
      gl.style.height = r.h + 'px';
    }
  }

  /**
   * 毛玻璃层的"冻结"动画。
   *
   * 关键点：让玻璃层的**尺寸在整个动画期间保持不变**，只改它的位置，
   * 于是 backdrop-filter 只需要算一次模糊，后面每帧只是被父级裁剪。
   * 如果把宽度当动画属性去补间，浏览器每帧都要按新尺寸重算一次高斯模糊，
   * 那才是真正掉帧的地方。
   *
   * 玻璃层比可见区域大一圈（union + 6px），位置用和父级完全相同的时长与
   * 缓动补间，因此在整个动画里它在"布局坐标系"里是静止的。
   */
  function morphGlass(node, a, b, dur, ease, delay) {
    var gl = glassOf(node);
    if (!gl || !gl.animate) { return; }
    var pad = 6;
    var ux = Math.min(a.x, b.x) - pad;
    var uy = Math.min(a.y, b.y) - pad;
    var uw = Math.max(a.x + a.w, b.x + b.w) + pad - ux;
    var uh = Math.max(a.y + a.h, b.y + b.h) + pad - uy;
    gl.style.width = uw + 'px';
    gl.style.height = uh + 'px';
    if (gl.__glassAnim) { try { gl.__glassAnim.cancel(); } catch (e) { } gl.__glassAnim = null; }
    gl.__glassAnim = gl.animate(
      [
        { left: (ux - a.x) + 'px', top: (uy - a.y) + 'px' },
        { left: (ux - b.x) + 'px', top: (uy - b.y) + 'px' }
      ],
      { duration: dur, delay: delay || 0, easing: ease, fill: 'both' }
    );
  }

  /**
   * 聚焦放大 / 收起：三栏矩形一起补间，一条强缓出曲线（起步快、收尾长）。
   * 只补间 left/top/width/height —— 不碰 transform，所以文字不会被拉伸；
   * 也不碰 backdrop-filter，所以面板不会在动画中途"变暗"。
   */
  function morphRects(from, to, opts) {
    var speed = Number((S.settings.appearance && S.settings.appearance.animationSpeed) || 1) || 1;
    var collapse = !!(opts && opts.collapse);
    var expandKey = opts && opts.expandKey;
    // 放大 / 缩小是同一套样式的两个方向（in / out），所以进出永远连贯
    var style = AR.Motion ? AR.Motion.dir('zoneFocus', collapse ? 'out' : 'in') : null;
    var dur = Math.round(((style && style.dur) || (collapse ? 330 : 380)) / speed);
    var ease = AR.Motion ? AR.Motion.ease(style && style.ease) : 'cubic-bezier(.18,1,.28,1)';
    if (!dur) {                       // 「无动画」样式：直接落位
      setRects(to);
      return;
    }
    var stagger = Math.round(((style && style.stagger) || 0) / speed);
    var slot = 0;
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var node = $(ZONE_IDS[k]);
      var a = from[k], b = to[k];
      if (!node || !a || !b) { continue; }
      if (sameRect(a, b)) { setRectsOne(node, b); continue; }
      clearMorph(node);
      if (!node.animate) { setRectsOne(node, b); continue; }
      /**
       * 只有"被点开放大的那一栏"需要钉住内容：
       * 它的内容最多（课程卡 + 信息格），重排也最明显。
       * 另外两栏这时候只剩一行摘要，居中显示，跟着框缩放反而更自然。
       */
      // 只要这一栏在变大（宽或高），就把内容按最终尺寸钉住；
      // 上中下布局里是纵向变大，同样受益（文字不会跟着逐帧重排）
      if (k === expandKey && (b.w > a.w + 0.5 || b.h > a.h + 0.5)) { freezeInner(node, b); }
      node.__morph = node.animate(
        [
          { left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px' },
          { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }
        ],
        { duration: dur, delay: stagger * slot, easing: ease, fill: 'both' }
      );
      morphGlass(node, a, b, dur, ease, stagger * slot);
      slot++;
      node.__morph.onfinish = (function (target, rect) {
        return function () {
          setRectsOne(target, rect);          // 精确落位，清掉补间的浮点误差
        };
      })(node, b);
    }
  }

  /* ── 外壳：导航 / 视图切换 ───────────────────────────────── */

  /* ══════════════════════════════════════════════════════════════
     开发者工具（在开发者模式里可以随时开关，全部持久化）
       fps      帧率悬浮窗（看动效是否真掉帧）
       ripple   每次点按出现一个涟漪点（检查点击热区与命中位置）
       grid     8px 基线网格（对排版间距）
       outline  给所有盒子描边（看布局边界）
       slow     动画 0.25× 慢放（逐帧看动画曲线）
     关掉任何一项都立即恢复，不留残留节点/样式。
     ══════════════════════════════════════════════════════════════ */
  var DevTools = {
    flags: null,
    fpsNode: null,
    rafId: 0,
    lastT: 0,
    frames: 0
  };

  function devFlags() {
    var ap = S.settings.appearance;
    if (!ap.dev || typeof ap.dev !== 'object') { ap.dev = {}; }
    return ap.dev;
  }

  function devApply(persist) {
    var f = devFlags();
    document.body.classList.toggle('dev-outline', !!f.outline);
    document.body.classList.toggle('dev-grid', !!f.grid);
    if (f.fps) { devStartFps(); } else { devStopFps(); }
    if (persist) { AR.Store.save(true); }
  }

  function devStartFps() {
    if (DevTools.fpsNode) { return; }
    var n = el('<div class="dev-fps">-- fps</div>');
    document.body.appendChild(n);
    DevTools.fpsNode = n;
    DevTools.frames = 0;
    DevTools.lastT = performance.now();
    var step = function (t) {
      DevTools.frames++;
      if (t - DevTools.lastT >= 500) {
        var fps = Math.round(DevTools.frames * 1000 / (t - DevTools.lastT));
        n.textContent = fps + ' fps';
        n.classList.toggle('bad', fps < 50);
        DevTools.frames = 0;
        DevTools.lastT = t;
      }
      DevTools.rafId = requestAnimationFrame(step);
    };
    DevTools.rafId = requestAnimationFrame(step);
  }

  function devStopFps() {
    if (DevTools.rafId) { cancelAnimationFrame(DevTools.rafId); DevTools.rafId = 0; }
    if (DevTools.fpsNode && DevTools.fpsNode.parentNode) {
      DevTools.fpsNode.parentNode.removeChild(DevTools.fpsNode);
    }
    DevTools.fpsNode = null;
  }

  /** 点击涟漪：只在开发者模式里挂，别的用户完全不受影响 */
  document.addEventListener('pointerdown', function (ev) {
    if (!S || !S.settings || !S.settings.appearance) { return; }
    var f = (S.settings.appearance.dev) || {};
    if (!f.ripple) { return; }
    var dot = el('<span class="dev-ripple"></span>');
    dot.style.left = ev.clientX + 'px';
    dot.style.top = ev.clientY + 'px';
    document.body.appendChild(dot);
    if (dot.animate) {
      dot.animate(
        [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: .85 },
         { transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }],
        { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
      );
    }
    setTimeout(function () { if (dot.parentNode) { dot.parentNode.removeChild(dot); } }, 560);
  }, true);

  /** 诊断信息：复制成一段文本，方便反馈问题时贴给我 */
  function devDiagnostics() {
    var st = AR.Store.get();
    var info = {
      版本: AR.Const.APP_VERSION,
      屏幕: window.innerWidth + '×' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x',
      断点: Layout.profileKey,
      布局: (S.settings.layout && S.settings.layout.preset) || '-',
      课程: (st.courses || []).length,
      时段: (st.blocks || []).length,
      覆盖: (st.overrides || []).length,
      学期: (AR.Store.semesterList ? AR.Store.semesterList().length : 0),
      节次表: (st.periods || []).length,
      毛玻璃: S.settings.appearance.glassLevel,
      动画速度: S.settings.appearance.animationSpeed,
      磁贴风格: AR.Motion ? AR.Motion.tileMode() : false,
      配色方案: (S.settings.schedule && S.settings.schedule.colorScheme) || 'classic',
      动画样式: AR.Motion ? AR.Motion.saved() : {},
      开发者工具: devFlags(),
      内存MB: (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : '-')
    };
    var text = Object.keys(info).map(function (k) { return k + '：' + JSON.stringify(info[k]); }).join('\n');
    AR.Bridge.copy(text);
    toast('诊断信息已复制');
  }

  function show(view) {
    currentView = view;
    var views = ['today', 'week', 'import', 'settings'];
    for (var i = 0; i < views.length; i++) {
      var node = $('view-' + views[i]);
      if (node) { node.hidden = (views[i] !== view); }
    }
    var btns = document.querySelectorAll('.nav-btn');
    for (var b = 0; b < btns.length; b++) {
      if (btns[b].getAttribute('data-nav') === view) { btns[b].classList.add('active'); }
      else { btns[b].classList.remove('active'); }
    }
    if (view === 'today') { AR.Bridge.haptic('light', $('zoneNext')); applyLayout(false); renderToday(); }
    if (view === 'week') { renderWeek(); }
    if (view === 'settings' && AR.Panels) { AR.Panels.renderSettings(); }
    if (view === 'import' && AR.Panels) { AR.Panels.renderImport(); }
    // 规格书 4.1：整屏区块 60ms 错峰入场
    var viewEl = $('view-' + view);
    enterRise(viewEl);
    enhanceSegmented(viewEl);
  }

  /* ── 今日页 ───────────────────────────────────────────────── */

  function fmtRange(item) {
    if (!item.start || !item.end) { return item.periodLabel || '时间待定'; }
    return item.start + ' – ' + item.end;
  }

  /**
   * 与「现在」的相对描述。
   * 注意要带上日期：早期版本只看时分，第二天早上的课会被算成「已结束」。
   */
  function relativeText(item, now, day) {
    if (item.startMin == null) { return ''; }
    var target = day || item.date || now;
    var dayDiff = U.daysBetween(now, target);
    if (dayDiff > 0) {
      if (dayDiff === 1) { return '明天'; }
      if (dayDiff === 2) { return '后天'; }
      return dayDiff + ' 天后';
    }
    if (dayDiff < 0) { return Math.abs(dayDiff) + ' 天前'; }
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var diff = item.startMin - nowMin;
    if (diff > 0) {
      if (diff < 60) { return diff + ' 分钟后开始'; }
      return Math.floor(diff / 60) + ' 小时 ' + (diff % 60) + ' 分钟后开始';
    }
    if (item.endMin != null && nowMin <= item.endMin) { return '正在进行'; }
    return '已结束';
  }

  /** compact 态的摘要块：收起的那一栏只显示一两行，绝不出现被挤成竖排的文字 */
  function compactBlock(big, small, hint, accent) {
    var bar = accent ? '<span class="zc-bar" style="background:' + accent + '"></span>' : '';
    return el('<div class="zone-compact' + (accent ? ' has-accent' : '') + '">' + bar
      + '<div class="zc-big">' + U.escapeHtml(big) + '</div>'
      + '<div class="zc-small">' + U.escapeHtml(small || '') + '</div>'
      + (hint ? '<div class="zc-hint">' + U.escapeHtml(hint) + '</div>' : '')
      + '</div>');
  }

  /**
   * 「最近的课」的时间状态色（阈值与颜色都能在设置里改）：
   *   live  正在上课        → 默认蓝
   *   near  距上课 ≤ 15 分钟 → 默认红
   *   soon  距上课 ≤ 30 分钟 → 默认黄
   *   其它  null（保持课程原色、边框不加粗）
   */
  function nextStatusOf(target, now) {
    var cfg = (S.settings && S.settings.nextAlert) || {};
    if (cfg.enabled === false || !target || !target.item) { return null; }
    var colors = cfg.colors || {};
    var thick = cfg.thickBorder !== false;
    var day = target.day || U.startOfDay(now);
    var item = target.item;
    var startMs = toMs(day, item.start);
    var endMs = toMs(day, item.end);
    if (!startMs) { return null; }
    if (endMs && now.getTime() >= startMs && now.getTime() < endMs) {
      return { key: 'live', label: '正在上课', color: colors.live || '#5B8DEF', thick: thick };
    }
    var mins = (startMs - now.getTime()) / 60000;
    var near = Number(cfg.nearMin) || 15;
    var soon = Number(cfg.soonMin) || 30;
    if (mins > 0 && mins <= near) {
      return { key: 'near', label: near + ' 分钟内上课', color: colors.near || '#E5484D', thick: thick };
    }
    if (mins > 0 && mins <= soon) {
      return { key: 'soon', label: soon + ' 分钟内上课', color: colors.soon || '#D9A22B', thick: thick };
    }
    return null;
  }

  function renderToday() {
    var now = new Date();
    var isToday = U.sameDay(cursorDate, now);
    var sem = AR.Store.currentSemester();
    var weekNo = AR.Schedule.weekNumber(cursorDate, sem);
    var ex = Layout.expanded;

    $('todayTitle').textContent = isToday ? '今日' : (cursorDate.getMonth() + 1) + ' 月 ' + cursorDate.getDate() + ' 日';
    var sub = U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)];
    if (sem) { sub += ' · ' + sem.name + ' 第 ' + Math.max(weekNo, 1) + ' 周'; }
    $('todaySub').textContent = sub;
    $('railWeekInfo').textContent = sem ? ('第 ' + Math.max(weekNo, 1) + ' 周') : '';
    $('railVersion').textContent = 'v' + AR.Const.APP_VERSION;
    updateClock();

    var items = AR.Schedule.dayItems(cursorDate, sem);
    $('todayBadge').textContent = items.length ? (items.length + ' 节课') : '无课';
    $('weekBadge').textContent = '第 ' + Math.max(weekNo, 1) + ' 周';

    /* 今日时间线 */
    var body = $('todayBody');
    body.innerHTML = '';
    var detailed = (ex === 'today');
    /**
     * 展开态下另外两栏的呈现层级：
     *   compact —— 被挤到很窄（≤1/3），只留一行摘要，点一下切过来
     *   普通    —— 左右布局里右侧那栏仍然有 38% 宽度，继续显示完整内容
     */
    var compactMap = compactZones(ex, Layout.preset);
    var weekCompact = compactMap.week;
    var nextCompact = compactMap.next;

    if (ex && !detailed) {
      var lastEnd = items.length ? (items[items.length - 1].end || '—') : '';
      body.appendChild(compactBlock(items.length ? (items.length + ' 节课') : '今天没有课',
        items.length ? ((items[0].start || '—') + ' – ' + lastEnd) : '', '点开看今日安排'));
      renderWeekRail(weekNo, sem, ex === 'week', weekCompact);
      renderNextPanel(now, ex === 'next', nextCompact);
      return;
    }
    if (!items.length) {
      body.appendChild(el('<div class="empty"><div class="big">☕</div><div class="t">今天没有课</div><div class="muted">去「导入」把课表加进来吧</div></div>'));
    } else {
      if (detailed) {
        // 展开态补充：整日快捷操作
        var tools = el('<div class="zone-tools">'
          + '<button class="chip-btn" type="button" data-act="copy">复制今日安排</button>'
          + '<button class="chip-btn" type="button" data-act="cal">第一节加入日历</button>'
          + '<span class="zone-stat">共 ' + items.length + ' 节</span></div>');
        tools.querySelector('[data-act="copy"]').addEventListener('click', function () {
          var lines = [];
          for (var q = 0; q < items.length; q++) {
            lines.push(fmtRange(items[q]) + ' ' + items[q].course.name
              + (items[q].location ? ' @ ' + items[q].location.raw : ''));
          }
          AR.Bridge.copy((U.dateKey(cursorDate) + ' ' + U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)] + '\n') + lines.join('\n'));
        });
        tools.querySelector('[data-act="cal"]').addEventListener('click', function () {
          var first = items[0];
          var startMs = toMs(cursorDate, first.start) || Date.now();
          var endMs = toMs(cursorDate, first.end) || (startMs + 45 * 60000);
          AR.Bridge.addCalendarEvent(first.course.name, first.location ? first.location.raw : '',
            'Abbey Road 课表 · ' + first.periodLabel, startMs, endMs);
          AR.Bridge.haptic('medium', tools);
        });
        body.appendChild(tools);
      }
      if (isToday) {
        body.appendChild(el('<div class="now-line"><span class="dot"></span><span class="line"></span><span class="label">现在 '
          + U.timeKey(now) + '</span></div>'));
      }
      for (var i = 0; i < items.length; i++) {
        body.appendChild(detailed ? todayDetailCard(items[i], now, isToday) : todayCard(items[i], now, isToday));
      }
      /* 特殊事件（考试 / 讲座 / 活动）也按长条卡片列在今天里 */
      var dayEvents = AR.Store.eventsOf ? AR.Store.eventsOf(cursorDate) : [];
      for (var ei = 0; ei < dayEvents.length; ei++) {
        body.appendChild(eventStrip(dayEvents[ei]));
      }
      fadeInList(body, '.card');                    // 规格书 4.2：列表只做淡入
    }

    /* 左侧：本周概览 */
    renderWeekRail(weekNo, sem, ex === 'week', weekCompact);

    /* 右侧：最近的课 */
    renderNextPanel(now, ex === 'next', nextCompact);

    /* 桌面卡片：把最新快照交给原生外壳（防抖 400ms，渲染期间不打扰） */
    if (AR.WidgetData && AR.WidgetData.sync) { AR.WidgetData.sync(); }
  }

  function todayCard(item, now, isToday) {
    var status = isToday ? relativeText(item, now) : '';
    var dim = status === '已结束' ? ' style="opacity:.55"' : '';
    var loc = item.location ? U.escapeHtml(item.location.raw) : '地点待补全';
    var teachers = item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '老师待补全';
    var tags = '';
    if (status) { tags += '<span class="tag' + (status === '正在进行' ? ' success' : '') + '">' + status + '</span>'; }
    if (item.isConsecutive) { tags += '<span class="tag">连堂</span>'; }
    if (item.kind === 'move' || item.kind === 'moved-in') { tags += '<span class="tag warn">调课</span>'; }
    if (item.kind === 'room') { tags += '<span class="tag warn">换教室</span>'; }
    if (item.kind === 'time') { tags += '<span class="tag warn">换时间</span>'; }
    if (item.kind === 'edit') { tags += '<span class="tag warn">单次调整</span>'; }
    if (item.kind === 'makeup' || item.kind === 'add') { tags += '<span class="tag warn">补课</span>'; }
    var node = el('<div class="strip"' + dim + '>'
      + '<span class="st-bar" style="background:' + item.color + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-head"><span class="st-title">' + U.escapeHtml(item.course.name) + '</span>'
      + '<span class="st-when">' + U.escapeHtml(item.periodLabel) + '</span></div>'
      // 地点 / 老师各自成块、靠间距分开：以前用 ' · ' 拼成一句话，
      // 换行时会留下"行首一个孤零零的 ·"，很难看
      + '<div class="st-meta"><span class="st-time">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="st-loc">' + softParens(loc) + '</span>'
      + '<span class="st-teacher">' + U.escapeHtml(teachers) + '</span></div>'
      + (tags ? '<div class="st-tags">' + tags + '</div>' : '')
      + '</div></div>');
    node.addEventListener('click', function () {
      // 所在栏收起时，点击是"展开这一栏"，不进详情
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
  }

  /**
   * 信息格：标签在上、值在下，点开就是对应的毛玻璃弹窗。
   * 用 CSS Grid 自动分列 —— 栏够宽就是两列，窄屏自动掉成一列，
   * 不再出现"一个信息占满一整个宽屏行"的松散排版。
   */
  function infoCell(key, value, onClick, opts) {
    var text = value == null ? '' : String(value);
    var empty = !text || text === '（空）' || text === '未填写' || text === '待补全' || text === '—';
    /**
     * 默认所有格子一样大：网格是 repeat(auto-fit, minmax(146px, 1fr))，
     * 长内容自己在格子里换行。早期版本按文字长度让格子"跨两列"，
     * 结果是长短不一、行里留洞，看着很乱 —— 统一尺寸反而最整齐。
     */
    var wide = !!(opts && opts.wide);
    var node = el('<button class="info-cell' + (wide ? ' wide' : '') + (empty ? ' empty' : '')
      + '" type="button"><div class="ic-k">' + U.escapeHtml(key) + '</div>'
      + '<div class="ic-v">' + U.escapeHtml(softParens(text || '未填写')) + '</div></button>');
    node.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (expandOwningZone(node)) { return; }
      AR.Bridge.haptic('light', node);
      if (onClick) { onClick(); }
    });
    return node;
  }

  /**
   * 在"（"前插一个零宽空格：窄栏里优先在括号前断行，
   * 而不是把「（阶梯-白板2）」从中间劈成「（阶」＋「梯-白板2）」。
   * 万一括号内容比一整行还长，浏览器仍会在括号内找断点，不会溢出。
   */
  function softParens(s) {
    return String(s == null ? '' : s).replace(/([^\s（(\u200B])([（(])/g, '$1\u200B$2');
  }

  /** 展开态下的今日卡片：长条卡片 + 一排信息格，点哪一格改哪一项 */
  function todayDetailCard(item, now, isToday) {
    var status = isToday ? relativeText(item, now) : '';
    var teachers = item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '—';
    var sem = AR.Store.currentSemester();
    var tags = '';
    if (item.isConsecutive) { tags += '<span class="tag">连堂</span>'; }
    if (item.kind !== 'normal') { tags += '<span class="tag warn">' + kindLabel(item.kind) + '</span>'; }
    var node = el('<div class="card flat today-card">'
      + '<span class="card-accent" style="background:' + item.color + '"></span>'
      + '<div class="card-row between">'
      + '<span class="time-chip">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="muted">' + U.escapeHtml(item.periodLabel)
      + (status ? ' · ' + U.escapeHtml(status) : '') + '</span>'
      + '</div>'
      + '<div class="card-title" style="margin-top:6px;font-size:16px">' + U.escapeHtml(item.course.name) + '</div>'
      + '<div class="st-meta" style="margin-top:4px">'
      + '<span class="st-loc">' + U.escapeHtml(softParens(item.location ? item.location.raw : '地点待补全')) + '</span>'
      + '<span class="st-teacher">' + U.escapeHtml(teachers === '—' ? '老师待补全' : teachers) + '</span>'
      + '</div>'
      + (tags ? '<div class="st-tags">' + tags + '</div>' : ''));
    node.appendChild(infoStack(item, {
      day: item.date,
      period: item.periodLabel || '未设置',
      teachers: teachers,
      weeks: AR.Schedule.weeksLabel(item.block, sem ? sem.weekCount : 20)
    }));
    var tools = el('<div class="zone-tools"><button class="chip-btn" type="button" data-act="edit">编辑全部信息</button>'
      + '<button class="chip-btn" type="button" data-act="cal">加入系统日历</button></div>');
    tools.querySelector('[data-act="edit"]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      openBlockEditor(item);
    });
    tools.querySelector('[data-act="cal"]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      var startMs = toMs(item.date, item.start) || Date.now();
      var endMs = toMs(item.date, item.end) || (startMs + 45 * 60000);
      AR.Bridge.addCalendarEvent(item.course.name, item.location ? item.location.raw : '',
        'Abbey Road 课表 · ' + item.periodLabel, startMs, endMs);
      AR.Bridge.haptic('medium', tools);
    });
    node.appendChild(tools);
    return node;
  }

  /**
   * 信息区：位置（整行）＋ 节次/时间/老师/周次（成对）＋ 备注（整行）。
   *
   * 分成三组而不是一个大网格，是为了在**任何栏宽**下都不出现"一行只放一个格子、
   * 旁边空两格"的破相：窄栏两列（2×2），平板横向宽到 640px 以上自动变四列一排。
   */
  function infoStack(item, fields) {
    var box = el('<div class="info-stack"></div>');

    var g1 = el('<div class="info-grid"></div>');
    g1.appendChild(infoCell('位置', item.location ? item.location.raw : '未填写',
      function () { openLocationModal(item); }));
    box.appendChild(g1);

    var g2 = el('<div class="info-grid pairs"></div>');
    g2.appendChild(infoCell('节次', fields.period, function () { openBlockEditor(item, { focus: 'period' }); }));
    g2.appendChild(infoCell('时间',
      U.WEEKDAY_NAMES[U.weekdayOf(fields.day)] + ' · ' + fmtRange(item),
      function () { openTimeModal(item, fields.day); }));
    g2.appendChild(infoCell('老师', fields.teachers && fields.teachers !== '—' ? fields.teachers : '未填写',
      function () { openTeacherModal(item); }));
    g2.appendChild(infoCell('周次', fields.weeks, function () { openBlockEditor(item); }));
    box.appendChild(g2);

    var g3 = el('<div class="info-grid"></div>');
    g3.appendChild(infoCell('备注', item.note || '（空）', function () { openNoteModal(item); }));
    box.appendChild(g3);

    return box;
  }

  function kindLabel(kind) {
    return kind === 'move' ? '调课' : (kind === 'moved-in' ? '调课（补到本日）' : (kind === 'room' ? '换教室'
      : (kind === 'time' ? '换时间' : (kind === 'edit' ? '单次调整' : (kind === 'makeup' ? '补课' : (kind === 'add' ? '加课' : '—'))))));
  }

  /* ── 特殊事件（考试 / 讲座 / 活动）───────────────────────── */

  function eventWhenText(ev) {
    var s = ev.date || '';
    if (ev.start) { s += ' ' + ev.start + (ev.end ? '–' + ev.end : ''); }
    return s;
  }

  /** 今日列表里的事件长条：颜色来自事件类型 */
  function eventStrip(ev) {
    var t = AR.Store.eventType(ev.type);
    var node = el('<div class="strip ev-strip">'
      + '<span class="st-bar" style="background:' + t.hex + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-head"><span class="st-title">' + U.escapeHtml(ev.title) + '</span>'
      + '<span class="ev-tag" style="background:' + t.hex + '">' + t.label + '</span></div>'
      + '<div class="st-meta"><span class="st-time">' + U.escapeHtml(eventWhenText(ev)) + '</span>'
      + (ev.place ? ' · ' + U.escapeHtml(ev.place) : '')
      + (ev.note ? ' · ' + U.escapeHtml(ev.note) : '') + '</div>'
      + '</div></div>');
    node.addEventListener('click', function () { openEventModal(ev); });
    return node;
  }

  /** 事件详情：可以加入系统日历 / 删除 */
  function openEventModal(ev) {
    var t = AR.Store.eventType(ev.type);
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">类型</div><div class="detail-val">' + t.label + '</div>'
      + '<div class="detail-key">日期</div><div class="detail-val">' + U.escapeHtml(ev.date) + '</div>'
      + (ev.start ? '<div class="detail-key">时间</div><div class="detail-val">' + U.escapeHtml(ev.start)
          + (ev.end ? ' – ' + U.escapeHtml(ev.end) : '') + '</div>' : '')
      + (ev.place ? '<div class="detail-key">地点</div><div class="detail-val">' + U.escapeHtml(ev.place) + '</div>' : '')
      + (ev.note ? '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(ev.note) + '</div>' : '')
      + '</div>';
    openModal({
      title: ev.title, sub: '特殊事件 · ' + t.label, body: body,
      actions: [
        {
          label: '加入系统日历',
          onClick: function () {
            var day = U.parseDateKey(ev.date) || new Date();
            var startMs = toMs(day, ev.start) || (day.getTime() + 9 * 3600000);
            var endMs = toMs(day, ev.end) || (startMs + 90 * 60000);
            AR.Bridge.addCalendarEvent(ev.title, ev.place || '', t.label + (ev.note ? ' · ' + ev.note : ''), startMs, endMs);
          }
        },
        {
          label: '删除事件', kind: 'danger',
          onClick: function (close) {
            AR.Store.removeEvent(ev.id);
            close();
            renderToday();
            if (currentView === 'week') { renderWeek(); }
            toast('已删除事件');
          }
        },
        { label: '关闭', kind: 'primary', onClick: function (close) { close(); } }
      ]
    });
  }

  /** 展开的「本周概览」里，把这一周的考试/讲座列出来（可点开详情） */
  function weekEventList(sem, weekNo) {
    var wrap = el('<div class="ev-list"></div>');
    var evs = AR.Store.eventsInWeek ? AR.Store.eventsInWeek(weekNo, sem) : [];
    if (!evs.length) { return wrap; }
    wrap.appendChild(el('<div class="ev-list-title">本周特殊事件</div>'));
    for (var i = 0; i < evs.length; i++) {
      (function (ev) {
        var t = AR.Store.eventType(ev.type);
        var row = el('<div class="ev-row"><span class="ev-tag" style="background:' + t.hex + '">'
          + t.label + '</span><span class="ev-name">' + U.escapeHtml(ev.title) + '</span>'
          + '<span class="ev-when">' + U.escapeHtml(eventWhenText(ev)) + '</span></div>');
        row.addEventListener('click', function () { openEventModal(ev); });
        wrap.appendChild(row);
      })(evs[i]);
    }
    return wrap;
  }

  /* ── 「最近的课」倒计时：定时刷新，不用整页重画 ─────────────
     以前只有进入页面时算一次，「还有 7 小时 52 分钟」会一直挂在那儿不动。
     现在每 10 秒（以及从后台回到前台时）重算一次：
       · 还是同一节课、状态没变 → 只改那一行文字（几乎零开销）
       · 换课了 / 状态色变了（进入 30 分钟 / 15 分钟 / 正在上课）→ 整块重画
     ────────────────────────────────────────────────────────── */

  function tickNextPanel() {
    if (document.hidden || currentView !== 'today') { return; }
    var node = $('nextCountdown');
    if (!node || !nextState) { return; }
    var now = new Date();
    var ongoing = AR.Schedule.ongoingItem(now);
    var next = AR.Schedule.nextItem(now);
    var target = ongoing
      ? { item: ongoing, day: U.startOfDay(now), offsetDays: 0, ongoing: true }
      : next;
    if (!target) { renderToday(); return; }

    var item = target.item;
    var st = nextStatusOf(target, now);
    var statusKey = st ? st.key : 'none';
    var changed = item.blockId !== nextState.blockId
      || U.dateKey(target.day) !== nextState.dayKey
      || statusKey !== nextState.statusKey;
    if (changed) { renderToday(); return; }      // 换课 / 变色：交给整块重画

    var text = relativeText(item, now, target.day) || '';
    if (node.textContent !== text) { node.textContent = text; }
    var badge = $('nextBadge');
    if (badge) {
      if (target.ongoing) { badge.textContent = '正在进行'; }
      else if (target.offsetDays === 0) { badge.textContent = '就在今天'; }
      else if (target.offsetDays === 1) { badge.textContent = '明天'; }
      else { badge.textContent = target.offsetDays + ' 天后'; }
    }
  }

  function startNextTicker() {
    if (nextTickTimer) { return; }
    nextTickTimer = setInterval(tickNextPanel, 10000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { tickNextPanel(); }
    });
  }

  /** 顶栏时钟：精确到秒（每秒刷新，秒数用弱一点的颜色，读数更清楚） */
  function updateClock() {
    var now = new Date();
    var t = $('todayClock');
    if (t) {
      t.innerHTML = U.pad2(now.getHours()) + ':' + U.pad2(now.getMinutes())
        + '<span class="clock-sec">:' + U.pad2(now.getSeconds()) + '</span>';
    }
    var d = $('todayClockDate');
    if (d) {
      d.textContent = (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · '
        + U.WEEKDAY_NAMES[U.weekdayOf(now)];
    }
  }

  function renderWeekRail(weekNo, sem, expanded, compact) {
    var body = $('weekBody');
    body.innerHTML = '';
    var monday = U.mondayOf(cursorDate);
    var today = U.startOfDay(new Date());

    // compact：这一栏没被展开 → 只显示一行摘要，避免被挤成竖排乱码
    if (compact) {
      var sum = 0, busyDays = 0;
      for (var sc = 1; sc <= 7; sc++) {
        var scCount = AR.Schedule.dayItems(U.addDays(monday, sc - 1), sem).length;
        sum += scCount;
        if (scCount) { busyDays++; }
      }
      body.appendChild(compactBlock('第 ' + Math.max(weekNo, 1) + ' 周',
        sum ? (sum + ' 节 · ' + busyDays + ' 天有课') : '这周没有课', '点开看整周'));
      return;
    }

    // 展开后顶部多一个「本周课表 / 月视图」切换
    if (expanded) {
      var seg = el('<div class="segmented" style="margin-bottom:10px"></div>');
      var modes = [{ k: 'week', t: '本周课表' }, { k: 'month', t: '月视图' }];
      for (var m = 0; m < modes.length; m++) {
        (function (mo) {
          var b = el('<button class="seg' + (weekZoneMode === mo.k ? ' active' : '') + '" type="button">' + mo.t + '</button>');
          b.addEventListener('click', function () {
            weekZoneMode = mo.k;
            AR.Bridge.haptic('light', b);
            renderWeekRail(weekNo, sem, true, false);
          });
          seg.appendChild(b);
        })(modes[m]);
      }
      body.appendChild(seg);
      // 展开态补充：本周统计
      var counts = [], totalWeek = 0, busiest = -1, busiestDay = 1;
      for (var wc = 1; wc <= 7; wc++) {
        var cCount = AR.Schedule.dayItems(U.addDays(monday, wc - 1), sem).length;
        counts.push(cCount);
        totalWeek += cCount;
        if (cCount > busiest) { busiest = cCount; busiestDay = wc; }
      }
      body.appendChild(el('<div class="zone-tools">'
        + '<span class="zone-stat">本周 ' + totalWeek + ' 节</span>'
        + '<span class="zone-stat">有课 ' + counts.filter(function (x) { return x > 0; }).length + ' 天</span>'
        + (totalWeek ? '<span class="zone-stat">最多 ' + U.WEEKDAY_NAMES[busiestDay] + ' ' + busiest + ' 节</span>' : '')
        + '</div>'));
      if (weekZoneMode === 'month') { renderMonthView(body, sem); return; }
      // 展开态：整张周表（和「周表」页同一套结构，只是窄一点）
      // 窄栏里也用"按可用高度算行高"，只是行高区间更小
      var railAvail = Math.max(0, body.clientHeight - 40);
      body.appendChild(weekTableNode(sem, Math.max(weekNo, 1),
        { narrow: true, clickDays: true, fitH: railAvail }));
      body.appendChild(weekEventList(sem, Math.max(weekNo, 1)));
      body.appendChild(el('<div class="mini-foot">点课程块看详情；点日期切换「今日」。</div>'));
      return;
    }

    /**
     * 折叠态：迷你周表（和「周表」同构：日期在上、节次在左、课程是色块）
     * + 选中那一日的长条卡片。
     */
    var mini = weekTableNode(sem, Math.max(weekNo, 1), { mini: true });
    mini.classList.add('rail-mini');
    body.appendChild(mini);
    body.appendChild(el('<div class="mini-foot">' + U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)] + ' '
      + (cursorDate.getMonth() + 1) + '/' + cursorDate.getDate()
      + ' · 点日期切换，点色块展开整周</div>'));
    return;
  }

  /** 本周条目：简洁长条卡片（时间、地点、老师都在，文字自动换行不省略） */
  function weekRailRowRich(item) {
    var node = el('<div class="strip">'
      + '<span class="st-bar" style="background:' + item.color + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-head"><span class="st-title">' + U.escapeHtml(item.course.name) + '</span>'
      + '<span class="st-when">' + U.escapeHtml(item.periodLabel) + '</span></div>'
      + '<div class="st-meta"><span class="st-time">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="st-loc">' + U.escapeHtml(item.location ? item.location.raw : '地点待补全') + '</span>'
      + '<span class="st-teacher">' + U.escapeHtml(item.teachers.length
        ? item.teachers.map(function (t) { return t.name; }).join('、') : '老师待补全') + '</span>'
      + (item.isConsecutive ? '<span class="st-teacher">连堂</span>' : '')
      + '</div></div></div>');
    node.addEventListener('click', function () {
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
  }

  /** 月视图：整月的课表密度 + 点日期直接跳转 */
  function renderMonthView(container, sem) {
    if (!monthCursor) { monthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1); }
    var today = U.startOfDay(new Date());

    var bar = el('<div class="month-nav">'
      + '<button class="icon-btn" data-m="-1" type="button" title="上个月">‹</button>'
      + '<span class="month-title">' + monthCursor.getFullYear() + ' 年 ' + (monthCursor.getMonth() + 1) + ' 月</span>'
      + '<button class="icon-btn" data-m="1" type="button" title="下个月">›</button>'
      + '</div>');
    var shiftBtns = bar.querySelectorAll('[data-m]');
    for (var s = 0; s < shiftBtns.length; s++) {
      (function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var delta = Number(b.getAttribute('data-m'));
          monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1);
          AR.Bridge.haptic('light', b);
          renderWeekRail(AR.Schedule.weekNumber(cursorDate, sem), sem, true, false);
        });
      })(shiftBtns[s]);
    }
    container.appendChild(bar);

    var back = el('<button class="chip-btn" type="button" style="margin-bottom:10px">回到今天</button>');
    back.addEventListener('click', function () {
      cursorDate = new Date();
      monthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
      renderToday();
    });
    container.appendChild(back);

    var head = el('<div class="month-head"></div>');
    for (var h = 1; h <= 7; h++) { head.appendChild(el('<span>' + U.WEEKDAY_NAMES[h].replace('周', '') + '</span>')); }
    container.appendChild(head);

    var grid = el('<div class="month-grid"></div>');
    var first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    var start = U.addDays(first, 1 - U.weekdayOf(first));
    for (var i = 0; i < 42; i++) {
      var d = U.addDays(start, i);
      var inMonth = d.getMonth() === monthCursor.getMonth();
      var items = AR.Schedule.dayItems(d, sem);
      var dots = '';
      for (var k = 0; k < Math.min(items.length, 3); k++) { dots += '<i></i>'; }
      var cls = 'month-cell' + (inMonth ? '' : ' out')
        + (U.sameDay(d, today) ? ' today' : '')
        + (U.sameDay(d, cursorDate) ? ' selected' : '');
      var cell = el('<button class="' + cls + '" type="button"><span>' + d.getDate()
        + '</span><span class="dots">' + dots + '</span></button>');
      (function (dd, node) {
        node.addEventListener('click', function (ev) {
          ev.stopPropagation();
          cursorDate = dd;
          AR.Bridge.haptic('light', node);
          renderToday();
        });
      })(d, cell);
      grid.appendChild(cell);
    }
    container.appendChild(grid);
    container.appendChild(el('<div class="muted" style="margin-top:10px">点日期即可切换；小圆点表示当天有课。</div>'));
  }

  function weekRailRow(item) {
    var node = el('<div class="week-course">'
      + '<span class="bar" style="background:' + item.color + '"></span>'
      + '<span class="txt"><b>' + U.escapeHtml(item.course.name) + '</b><br>'
      + U.escapeHtml(item.periodLabel) + ' · ' + U.escapeHtml(item.start || '') + '</span></div>');
    node.addEventListener('click', function () {
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
  }

  function renderNextPanel(now, expanded, compact) {
    var body = $('nextBody');
    body.innerHTML = '';
    var semNow = AR.Store.currentSemester();
    var next = AR.Schedule.nextItem(now);
    var ongoing = AR.Schedule.ongoingItem(now);
    var target = ongoing ? { item: ongoing, day: U.startOfDay(now), offsetDays: 0, ongoing: true } : next;

    if (!target) {
      $('nextBadge').textContent = '—';
      if (compact) {
        body.appendChild(compactBlock('最近没有安排', '未来两周都没有课', '点开看看'));
        return;
      }
      body.appendChild(el('<div class="empty"><div class="big">🌤</div><div class="t">最近没有安排</div><div class="muted">未来两周都没有课</div></div>'));
      return;
    }
    var item = target.item;
    var whenText = target.ongoing ? '正在进行' : (target.offsetDays === 0 ? '就在今天'
      : (target.offsetDays === 1 ? '明天' : target.offsetDays + ' 天后'));
    $('nextBadge').textContent = whenText;
    var st = nextStatusOf(target, now);      // 按离上课时间决定状态色（设置里可改）

    if (compact) {
      body.appendChild(compactBlock(whenText, item.course.name + ' · ' + (item.start || '时间待定'),
        st ? st.label : '点开看课程详情', st ? st.color : null));
      return;
    }

    // 状态色：只改边框（可选加粗）+ 一层很淡的同色光晕，不动课程本来颜色
    var heroStyle = st
      ? ' style="border:' + (st.thick ? 2 : 1) + 'px solid ' + st.color
        + ';box-shadow:0 0 0 3px ' + hexA(st.color, 0.16) + ', var(--shadow-card)"'
      : '';
    var stateTag = st
      ? '<span class="tag" style="background:' + st.color + ';color:#fff;border-color:transparent">'
        + U.escapeHtml(st.label) + '</span>'
      : '';
    var dayText = target.ongoing ? '正在进行'
      : (target.offsetDays === 0 ? '今天' : ((target.day.getMonth() + 1) + '/' + target.day.getDate()))
        + ' ' + U.WEEKDAY_NAMES[U.weekdayOf(target.day)];
    var hero = el('<div class="next-hero' + (expanded ? ' focus' : '') + '"' + heroStyle + '>'
      + '<span class="nh-bar" style="background:' + item.color + '"></span>'
      + '<div class="nh-main">'
      + '<div class="nh-top"><span class="nh-time">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="nh-day">' + U.escapeHtml(dayText) + '</span></div>'
      + '<div class="nh-title">' + U.escapeHtml(item.course.name) + '</div>'
      + '<div class="nh-sub"><span>' + U.escapeHtml(item.periodLabel) + '</span>'
      + '<span class="nh-count" id="nextCountdown">' + U.escapeHtml(relativeText(item, now, target.day) || '')
      + '</span></div>'
      + (stateTag ? '<div class="nh-tags">' + stateTag + '</div>' : '')
      + '</div></div>');
    hero.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (expandOwningZone(hero)) { return; }
      openCourseModal(item);
    });
    body.appendChild(hero);

    // 记下这一屏画的是哪节课、什么状态，供定时器判断「要不要整块重画」
    nextState = {
      blockId: item.blockId,
      dayKey: U.dateKey(target.day),
      statusKey: st ? st.key : 'none'
    };

    /**
     * 信息格：宽栏自动排成两列（以前是一列到底，一个宽屏行里就一行小字，
     * 又空又散）；窄屏自动掉回一列。每一项点开就是对应的弹窗。
     */
    /**
     * 信息区：位置（整行）＋ 节次/时间/老师/周次（成对）＋ 备注（整行）。
     * 宽栏（折叠屏展开 / 平板横屏）自动从 2 列变 4 列，不会出现"一行一个格子、
     * 旁边空两格"的破相 —— 之前一个大网格 auto-fit 就是这样。
     */
    body.appendChild(infoStack(item, {
      day: target.day,
      period: item.periodLabel || '未设置',
      teachers: item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '未填写',
      weeks: AR.Schedule.weeksLabel(item.block, semNow ? semNow.weekCount : 20)
    }));

    // 展开态补充：常用操作一步到位
    if (expanded) {
      var nextTools = el('<div class="zone-tools">'
        + '<button class="chip-btn" type="button" data-act="edit">编辑课程</button>'
        + '<button class="chip-btn" type="button" data-act="nav">打开导航</button>'
        + '<button class="chip-btn" type="button" data-act="cal">加入系统日历</button>'
        + '<button class="chip-btn" type="button" data-act="alarm">设闹钟</button>'
        + '<button class="chip-btn" type="button" data-act="copy">复制课程信息</button></div>');
      nextTools.querySelector('[data-act="edit"]').addEventListener('click', function () { openBlockEditor(item); });
      nextTools.querySelector('[data-act="nav"]').addEventListener('click', function () {
        var q = AR.Location.navQuery(item.location ? item.location.raw : '', S.settings).query;
        if (!q) { toast('这节课还没有地点'); return; }
        AR.Bridge.openMap(S.settings.integration.navApp, q, AR.Location.navWebUrl(q, S.settings.integration.navApp));
      });
      nextTools.querySelector('[data-act="cal"]').addEventListener('click', function () {
        var startMs = toMs(target.day, item.start) || Date.now();
        var endMs = toMs(target.day, item.end) || (startMs + 45 * 60000);
        AR.Bridge.addCalendarEvent(item.course.name, item.location ? item.location.raw : '',
          'Abbey Road 课表 · ' + item.periodLabel + (item.note ? ' · ' + item.note : ''), startMs, endMs);
      });
      nextTools.querySelector('[data-act="alarm"]').addEventListener('click', function () {
        var hm = (item.start || '08:00').split(':');
        AR.Bridge.setAlarm(Number(hm[0]), Number(hm[1]),
          item.course.name + ' ' + (item.location ? item.location.raw : ''));
      });
      nextTools.querySelector('[data-act="copy"]').addEventListener('click', function () {
        AR.Bridge.copy(item.course.name + ' ' + fmtRange(item)
          + (item.location ? ' @ ' + item.location.raw : '')
          + (item.teachers.length ? ' · ' + item.teachers.map(function (t) { return t.name; }).join('、') : ''));
      });
      body.appendChild(nextTools);
    }

    /**
     * 连堂是"结构信息"，不适合塞进信息格，单独一行小字说明。
     * 其它字段（周次 / 地点 / 备注 / 老师）已经在信息格里了，
     * 这里不再重复列一遍 —— 之前那版就是重复三遍，显得又长又乱。
     */
    if (item.isConsecutive) {
      body.appendChild(el('<div class="focus-only mute-line">连堂：'
        + (item.segments ? item.segments.map(function (s) { return s[0] + '-' + s[1]; }).join(' + ') : '自动识别')
        + '</div>'));
    }
  }

  function moduleBtn(k, v, onClick) {
    var node = el('<button class="module" type="button"><div class="k">' + k + '</div><div class="v">'
      + U.escapeHtml(v) + '</div></button>');
    node.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (expandOwningZone(node)) { return; }   // 收起状态下先展开这一栏
      AR.Bridge.haptic('light', node);
      onClick();
    });
    return node;
  }

  /* ── 周表 ─────────────────────────────────────────────────── */

  /**
   * 学期切换（周表右上角按钮）。
   * 列出所有学期（开学日期 + 课程数），点一个就切过去；
   * 也允许在这里直接新建一个学期，方便下学期接着用。
   */
  function openSemesterPicker() {
    var list = AR.Store.semesterList();
    var cur = AR.Store.currentSemester();
    var body = el('<div></div>');
    body.appendChild(el('<p class="muted">当前学期：' + U.escapeHtml(cur ? cur.name : '—')
      + '。切过去之后，周表、今日页都会跟着换。</p>'));

    var box = el('<div class="export-list"></div>');
    for (var i = 0; i < list.length; i++) {
      (function (sem) {
        var isCur = cur && sem.id === cur.id;
        var courses = AR.Store.courseCountOfSemester(sem.id);
        var row = el('<button class="export-row' + (isCur ? ' active' : '') + '" type="button">'
          + '<span class="er-name">' + U.escapeHtml(sem.name) + (isCur ? ' · 当前' : '') + '</span>'
          + '<span class="er-meta">' + U.escapeHtml(sem.startDate || '') + ' 起 · ' + sem.weekCount + ' 周 · '
          + courses + ' 门课</span></button>');
        row.addEventListener('click', function () {
          if (isCur) { closeModal(); return; }
          AR.Bridge.haptic('medium', row);
          var res = AR.Store.setCurrentSemester(sem.id);
          closeModal();
          if (!res.ok) { toast(res.message || '切换失败'); return; }
          weekCursor = null;                 // 重新按新学期算「第几周」
          cursorDate = new Date();
          renderToday();
          if (currentView === 'week') { renderWeek({ swap: 0 }); }
          toast('已切换到「' + sem.name + '」');
        });
        box.appendChild(row);
      })(list[i]);
    }
    body.appendChild(box);

    openModal({
      title: '切换学期', sub: '共 ' + list.length + ' 个学期',
      body: body,
      actions: [
        { label: '新建学期', onClick: function (c) { c(); openNewSemesterModal(); } },
        { label: '关闭', kind: 'primary', onClick: function (c) { c(); } }
      ]
    });
  }

  /** 新建一个学期（名字 + 开学第一周周一 + 总周数），建完自动切过去 */
  function openNewSemesterModal() {
    var monday = U.mondayOf(new Date());
    var body = el('<div>'
      + '<div class="field"><label class="field-label">学期名称</label>'
      + '<input class="input" id="newSemName" value="' + ((new Date().getMonth() >= 6) ? '秋季学期' : '春季学期') + '"></div>'
      + '<div class="field"><label class="field-label">开学第一周周一</label>'
      + '<input class="input" type="date" id="newSemStart" value="' + U.dateKey(monday) + '"></div>'
      + '<div class="field"><label class="field-label">总周数</label>'
      + '<input class="input" type="number" min="1" max="30" id="newSemWeeks" value="20"></div>'
      + '</div>');
    openModal({
      title: '新建学期', sub: '新建后会自动切过去', body: body,
      actions: [
        { label: '取消', onClick: function (c) { c(); } },
        {
          label: '创建', kind: 'primary', onClick: function (c) {
            var name = ($('newSemName') && $('newSemName').value || '').trim();
            var start = $('newSemStart') && $('newSemStart').value;
            var weeks = Number($('newSemWeeks') && $('newSemWeeks').value) || 20;
            if (!name) { toast('请填学期名称'); return; }
            if (!start) { toast('请选开学日期'); return; }
            var res = AR.Store.addSemester({ name: name, startDate: start, weekCount: weeks });
            c();
            if (!res.ok) { toast(res.message || '新建失败'); return; }
            weekCursor = null;
            cursorDate = U.parseDateKey(start) || new Date();
            renderToday();
            if (currentView === 'week') { renderWeek({ swap: 0 }); }
            toast('已新建并切到「' + name + '」');
          }
        }
      ]
    });
  }

  function renderWeek(opts) {
    var sem = AR.Store.currentSemester();
    if (!sem) { return; }
    var weekCount = sem.weekCount || 20;
    if (weekCursor == null) { weekCursor = Math.max(1, AR.Schedule.weekNumber(new Date(), sem)); }
    $('weekSub').textContent = sem.name + ' · 第 ' + weekCursor + ' / ' + weekCount + ' 周';
    // 右上角的学期按钮：显示当前学期名，点开可以切学期
    var semBtn = $('weekSemBtn');
    if (semBtn) {
      var semCount = AR.Store.semesterList().length;
      semBtn.textContent = sem.name + (semCount > 1 ? ' ▾' : '');
      semBtn.title = semCount > 1 ? '切换学期' : '当前只有一个学期';
    }

    /**
     * 周视图 / 月视图切换（设置里可以关掉这个功能）。
     * 月视图按整月铺课程与事件，点某天直接跳回那一周。
     */
    var monthAllowed = !(S.settings.schedule && S.settings.schedule.weekMonthView === false);
    var modeBox = $('weekMode');
    if (modeBox) {
      modeBox.hidden = !monthAllowed;
      // 分段控件现在是静态标记（和周次条并排放在一行），这里只同步选中态
      var segs = modeBox.querySelectorAll('.seg');
      for (var mi = 0; mi < segs.length; mi++) {
        (function (b) {
          var m = b.getAttribute('data-mode') || 'week';
          b.classList.toggle('active', m === weekPageMode);
          if (!b.__wired) {
            b.__wired = true;
            b.addEventListener('click', function () {
              if (weekPageMode === m) { return; }
              weekPageMode = m;
              AR.Bridge.haptic('light', b);
              renderWeek({ swap: 0 });     // 周视图 ↔ 月视图：原地淡入 + 轻微缩放
            });
          }
        })(segs[mi]);
      }
      enhanceSegmented(modeBox);
      // 事件委托到容器上：点胶囊、点边缘都能切，避免任何覆盖层挡住小按钮
      if (!modeBox.__delegated) {
        modeBox.__delegated = true;
        modeBox.addEventListener('click', function (ev) {
          var t = ev.target;
          var b = (t && t.closest) ? t.closest('.seg') : null;
          if (!b) { return; }
          var m = b.getAttribute('data-mode') || 'week';
          if (weekPageMode === m) { return; }
          weekPageMode = m;
          AR.Bridge.haptic('light', b);
          renderWeek({ swap: 0 });
        }, true);
      }
    }
    var strip0 = $('weekStrip');
    if (monthAllowed && weekPageMode === 'month') {
      if (strip0) { strip0.hidden = true; }
      renderWeekMonth($('weekGridWrap'), sem);
      renderConflicts();
      if (opts && typeof opts.swap === 'number') { animateWeekSwap(opts.swap); }
      return;
    }
    if (strip0) { strip0.hidden = false; }

    renderWeekStrip(sem);
    renderWeekTable(sem);
    renderConflicts();
    if (opts && typeof opts.swap === 'number') { animateWeekSwap(opts.swap); }
  }

  /**
   * 周表「上一周 / 本周 / 下一周」与视图切换的过渡。
   * 规格书：只动 opacity / translate / scale。
   *   dir > 0 → 下一周，内容从右侧浮入
   *   dir < 0 → 上一周，内容从左侧浮入
   *   dir = 0 → 原地淡入（周视图 ↔ 月视图）
   */
  function animateWeekSwap(dir) {
    var wrap = $('weekGridWrap');
    if (wrap && wrap.animate) {
      var dx = (dir === 0) ? 0 : (dir > 0 ? 26 : -26);
      if (wrap.__swap) { try { wrap.__swap.cancel(); } catch (e) { } }
      wrap.__swap = wrap.animate(
        [
          { opacity: 0, transform: 'translateX(' + dx + 'px) scale(' + (dir === 0 ? '0.99' : '0.995') + ')' },
          { opacity: 1, transform: 'translateX(0px) scale(1)' }
        ],
        { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }
      );
    }
    var strip = $('weekStrip');
    if (strip) { fadeInList(strip, '.week-chip'); }     // 周次条：30ms 错峰淡入
    var sub = $('weekSub');
    if (sub && sub.animate) {
      if (sub.__swap) { try { sub.__swap.cancel(); } catch (e) { } }
      sub.__swap = sub.animate(
        [{ opacity: 0.2 }, { opacity: 1 }],
        { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }
  }

  /** 月视图：整月的课程密度 + 点某天跳回那一周 */
  function renderWeekMonth(container, sem) {
    container.innerHTML = '';
    if (!weekMonthCursor) {
      weekMonthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    }
    var today = U.startOfDay(new Date());

    var bar = el('<div class="month-nav">'
      + '<button class="icon-btn" data-m="-1" type="button" title="上个月">‹</button>'
      + '<span class="month-title">' + weekMonthCursor.getFullYear() + ' 年 '
      + (weekMonthCursor.getMonth() + 1) + ' 月</span>'
      + '<button class="icon-btn" data-m="1" type="button" title="下个月">›</button>'
      + '<button class="chip-btn" data-m="0" type="button">回到本周</button></div>');
    var navBtns = bar.querySelectorAll('[data-m]');
    for (var n = 0; n < navBtns.length; n++) {
      (function (b) {
        b.addEventListener('click', function () {
          var delta = Number(b.getAttribute('data-m'));
          if (delta === 0) {
            weekCursor = Math.max(1, AR.Schedule.weekNumber(new Date(), sem));
            cursorDate = new Date();
            weekMonthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
          } else {
            weekMonthCursor = new Date(weekMonthCursor.getFullYear(), weekMonthCursor.getMonth() + delta, 1);
          }
          AR.Bridge.haptic('light', b);
          // 月视图翻页也走同一套过渡：下个月从右侧浮入，上个月从左侧，回到本月原地淡入
          renderWeek({ swap: delta === 0 ? 0 : (delta > 0 ? 1 : -1) });
        });
      })(navBtns[n]);
    }
    container.appendChild(bar);

    var head = el('<div class="month-head"></div>');
    for (var h = 1; h <= 7; h++) { head.appendChild(el('<span>' + U.WEEKDAY_NAMES[h].replace('周', '') + '</span>')); }
    container.appendChild(head);

    var grid = el('<div class="month-cal"></div>');
    var first = new Date(weekMonthCursor.getFullYear(), weekMonthCursor.getMonth(), 1);
    var start = U.addDays(first, 1 - U.weekdayOf(first));
    for (var i = 0; i < 42; i++) {
      var d = U.addDays(start, i);
      var inMonth = d.getMonth() === weekMonthCursor.getMonth();
      var items = AR.Schedule.dayItems(d, sem);
      var events = AR.Store.eventsOf ? AR.Store.eventsOf(d) : [];
      var cls = 'mc-cell' + (inMonth ? '' : ' out') + (U.sameDay(d, today) ? ' today' : '')
        + (U.sameDay(d, cursorDate) ? ' selected' : '');
      var cell = el('<button class="' + cls + '" type="button"><span class="mc-d">' + d.getDate() + '</span></button>');
      var chips = el('<div class="mc-chips"></div>');
      for (var c = 0; c < items.length && c < 3; c++) {
        chips.appendChild(el('<span class="mc-chip" style="background:' + items[c].color + '">'
          + U.escapeHtml(items[c].course.name) + '</span>'));
      }
      if (items.length > 3) { chips.appendChild(el('<span class="mc-more">+' + (items.length - 3) + '</span>')); }
      for (var e2 = 0; e2 < events.length; e2++) {
        var t2 = AR.Store.eventType(events[e2].type);
        chips.appendChild(el('<span class="mc-ev" style="background:' + t2.hex + '">'
          + t2.mark + ' ' + U.escapeHtml(events[e2].title) + '</span>'));
      }
      cell.appendChild(chips);
      (function (dd, node) {
        node.addEventListener('click', function () {
          cursorDate = dd;
          weekCursor = Math.max(1, AR.Schedule.weekNumber(dd, sem));
          weekPageMode = 'week';        // 点日期 = 看那一周
          AR.Bridge.haptic('light', node);
          renderToday();
          renderWeek({ swap: 0 });      // 月 → 周：原地淡入
        });
      })(d, cell);
      grid.appendChild(cell);
    }
    container.appendChild(grid);
    container.appendChild(el('<div class="muted" style="margin-top:10px">点任意一天即可跳到那一周的课表。</div>'));
  }

  /** 冲突检测面板（周视图 / 月视图共用） */
  function renderConflicts() {

    /**
     * 冲突：不再占一块面板，改成右上角一个小按钮（带数量）。
     * 周表的纵向空间很宝贵，冲突多的时候更不该把课表挤成一条缝；
     * 点按钮直接弹窗口看清单。
     */
    var conflicts = AR.Schedule.conflicts();
    var btn = $('btnConflicts');
    var badge = $('conflictCount');
    if (conflicts.length) {
      if (btn) { btn.hidden = false; }
      if (badge) { badge.textContent = conflicts.length; }
    } else {
      if (btn) { btn.hidden = true; }
    }
  }

  /** 冲突清单弹窗（右上角按钮点开） */
  function openConflicts() {
    var conflicts = AR.Schedule.conflicts();
    var box = el('<div class="conflict-list"></div>');
    if (!conflicts.length) {
      box.appendChild(el('<p class="muted">没有检测到时间冲突。</p>'));
    } else {
      for (var c = 0; c < conflicts.length; c++) {
        box.appendChild(el('<div class="list-item ' + (conflicts[c].level === 'danger' ? 'danger' : '')
          + '"><span class="code-badge">' + conflicts[c].code + '</span><span class="msg">'
          + U.escapeHtml(conflicts[c].message) + '</span></div>'));
      }
    }
    openModal({
      title: '冲突检测',
      sub: conflicts.length ? ('共 ' + conflicts.length + ' 处，建议按提示调整') : '一切正常',
      body: box,
      actions: [{ label: '知道了', kind: 'primary', onClick: function (close) { close(); } }]
    });
  }

  /** 周次快切：1…总周数，点一下换周 */
  function renderWeekStrip(sem) {
    var strip = $('weekStrip');
    if (!strip) { return; }
    strip.innerHTML = '';
    var weekCount = sem.weekCount || 20;
    var nowWeek = Math.max(1, AR.Schedule.weekNumber(new Date(), sem));
    for (var w = 1; w <= weekCount; w++) {
      (function (n) {
        var chip = el('<button class="week-chip' + (n === weekCursor ? ' active' : '')
          + (n === nowWeek ? ' now' : '') + '" type="button">' + n + '</button>');
        chip.title = '第 ' + n + ' 周';
        chip.addEventListener('click', function () {
          weekCursor = n;
          weekDaySel = null;
          AR.Bridge.haptic('light', chip);
          renderWeek();
        });
        strip.appendChild(chip);
      })(w);
    }
    var active = strip.querySelector('.week-chip.active');
    if (active && active.scrollIntoView) {
      try { active.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { }
    }
  }

  /**
   * 整周课表格：一周 7 天的日期在上，节次与上课时间在左列，课程块按节次跨行。
   * 同一套结构复用在三处：周表页、本周概览展开态、本周概览迷你态（mini：只画色块）。
   */
  function weekTableNode(sem, weekNo, opts) {
    opts = opts || {};
    var mini = !!opts.mini;
    var narrow = !!opts.narrow;      // 放在「本周概览」这种窄栏里：时间列更细、字号更小
    var periods = AR.Store.periodsOf(sem.id);
    var monday = U.addDays(U.mondayOf(U.parseDateKey(sem.startDate)), (weekNo - 1) * 7);
    var today = U.startOfDay(new Date());

    // 这一周实际用到多少节
    var byIndex = {};
    for (var pi = 0; pi < periods.length; pi++) { byIndex[periods[pi].index] = periods[pi]; }
    var maxUsed = 0, weekTotal = 0;
    var dayItems = [];
    for (var d = 1; d <= 7; d++) {
      var its = AR.Schedule.weekItems(weekNo, d);
      dayItems.push(its);
      weekTotal += its.length;
      for (var i = 0; i < its.length; i++) {
        var endIdx = itemEndPeriod(its[i]);
        if (endIdx > maxUsed) { maxUsed = endIdx; }
      }
    }
    if (!maxUsed) { maxUsed = Math.min(periods.length || 8, mini ? 5 : 8); }
    var rows = Math.max(Math.min(maxUsed, mini ? 6 : maxUsed), 1);

    // 特殊事件（考试 / 讲座 / 活动）：在日期下面单独占一行，用专属颜色显示
    var weekEvents = AR.Store.eventsInWeek ? AR.Store.eventsInWeek(weekNo, sem) : [];
    var evRow = weekEvents.length ? 1 : 0;

    var table = el('<div class="week-table' + (mini ? ' mini-table' : '') + '"></div>');
    /**
     * 周表排版第一原则：**让一整个星期尽量同时看得见**。
     * 所以行高不是写死的，而是"拿可用高度 ÷ 节数"算出来的：
     *   · 先按容器高度算出理想行高，再夹在合理区间（40–78px，窄栏 34–64px）；
     *   · 行高偏小时自动进入紧凑模式（课块只留课名、时间列只留节次号），
     *     而不是把内容挤成一团；
     *   · 连最小行高都放不下时才允许滚动（总比字糊成一团强）。
     */
    var rowH = 0;
    if (mini) {
      table.style.gridTemplateColumns = '16px repeat(7, minmax(0, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '') + 'repeat(' + rows + ', minmax(9px, 1fr))';
    } else {
      var minRow = narrow ? 34 : 40;
      var maxRow = narrow ? 72 : 92;
      rowH = maxRow;
      if (opts.fitH) {
        // 表头 ~34px（紧凑时 ~28）、事件行 ~24px、行间 2px
        var headH = 34, evH = evRow ? 24 : 0;
        var usable = opts.fitH - headH - evH - (rows - 1 + (evRow ? 1 : 0)) * 2;
        rowH = Math.floor(usable / rows);
        rowH = Math.max(minRow, Math.min(maxRow, rowH));
      }
      if (narrow) { table.classList.add('rail-table'); }
      table.style.gridTemplateColumns = (narrow ? '34px' : '38px') + ' repeat(7, minmax(0, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '') + 'repeat(' + rows + ', ' + rowH + 'px)';
      table.style.setProperty('--wt-row', rowH + 'px');
      // 优先级：先牺牲老师，再牺牲地点与上下课时间 —— 课名和节次永远保留
      if (rowH < 44) { table.classList.add('wt-dense'); }
      if (rowH < 34) { table.classList.add('wt-tight'); }
    }

    // 表头：左上角显示月份，其余 7 列是「周X + 日期」（迷你版只留日期）
    table.appendChild(el('<div class="' + (mini ? 'mg-corner' : 'wt-corner') + '" style="grid-row:1;grid-column:1">'
      + (monday.getMonth() + 1) + ' 月</div>'));
    for (var dh = 1; dh <= 7; dh++) {
      var dDate = U.addDays(monday, dh - 1);
      var head = el('<div class="' + (mini ? 'mg-day' : 'wt-day') + (U.sameDay(dDate, today) ? ' today' : '')
        + '" style="grid-row:1;grid-column:' + (dh + 1) + '">'
        + (mini ? '' : '<span class="w">' + U.WEEKDAY_NAMES[dh] + '</span>')
        + '<span class="n">' + dDate.getDate() + '</span></div>');
      if (mini || opts.clickDays) {
        (function (dd) {
          head.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var prevMs = cursorDate ? cursorDate.getTime() : 0;
            cursorDate = dd;
            var dir = prevMs ? (dd.getTime() > prevMs ? 1 : (dd.getTime() < prevMs ? -1 : 0)) : 0;
            AR.Bridge.haptic('medium', head);   // 切换日期：震动 + 有方向的过渡
            renderToday();
            playDaySwitch(dir);
          });
        })(dDate);
      }
      table.appendChild(head);
    }

    // 事件行（第 2 行）：每天最多显示 2 条，颜色按类型区分
    if (evRow) {
      table.appendChild(el('<div class="' + (mini ? 'mg-evlabel' : 'wt-evlabel')
        + '" style="grid-row:2;grid-column:1">' + (mini ? '事' : '事件') + '</div>'));
      for (var ed = 1; ed <= 7; ed++) {
        var cellBox = el('<div class="' + (mini ? 'mg-evcell' : 'wt-evcell')
          + '" style="grid-row:2;grid-column:' + (ed + 1) + '"></div>');
        var mine = [];
        for (var we = 0; we < weekEvents.length; we++) {
          var wd = window.AR && U.weekdayOf(U.parseDateKey(weekEvents[we].date));
          if (wd === ed) { mine.push(weekEvents[we]); }
        }
        for (var mi = 0; mi < Math.min(mine.length, 2); mi++) {
          (function (ev) {
            var t = AR.Store.eventType(ev.type);
            var chip = el('<button class="ev-chip' + (mini ? ' mini' : '') + '" type="button"'
              + ' style="background:' + t.hex + ';border-color:' + t.hex + '" title="'
              + U.escapeHtml(t.label + ' · ' + ev.title) + '">'
              + '<span class="mark">' + t.mark + '</span>'
              + (mini ? '' : '<span class="txt">' + U.escapeHtml(ev.title) + '</span>')
              + '</button>');
            chip.addEventListener('click', function (ev2) {
              ev2.stopPropagation();
              openEventModal(ev);
            });
            cellBox.appendChild(chip);
          })(mine[mi]);
        }
        if (mine.length > 2) { cellBox.appendChild(el('<span class="ev-more">+' + (mine.length - 2) + '</span>')); }
        table.appendChild(cellBox);
      }
    }

    // 占用表：被跨行课程块盖住的格子不再单独画
    var occupied = {};
    for (var r0 = 0; r0 < rows; r0++) {
      for (var c0 = 1; c0 <= 7; c0++) { occupied[r0 + '_' + c0] = false; }
    }

    for (var row = 0; row < rows; row++) {
      var pIdx = row + 1;
      var per = byIndex[pIdx];
      table.appendChild(el('<div class="' + (mini ? 'mg-time' : 'wt-time') + '" style="grid-row:' + (row + 2 + evRow) + ';grid-column:1">'
        + (mini ? '<span class="p">' + pIdx + '</span>'
                // v0.2.0：最左边直接显示「几点到几点」，节次号缩成一个小角标
                : '<span class="p">' + pIdx + '</span>'
                  + '<span class="t">' + (per ? U.escapeHtml(per.start || '—') : '—') + '</span>'
                  + '<span class="range-line"></span>'
                  + '<span class="t">' + (per ? U.escapeHtml(per.end || '—') : '—') + '</span>')
        + '</div>'));

      for (var day = 1; day <= 7; day++) {
        if (occupied[row + '_' + day]) { continue; }
        var list = dayItems[day - 1];
        var hit = null;
        for (var k = 0; k < list.length; k++) {
          if (itemStartPeriod(list[k]) === pIdx) { hit = list[k]; break; }
        }
        if (!hit) {
          var emptyCell = el('<div class="' + (mini ? 'mg-empty' : 'wt-empty') + '" style="grid-row:'
            + (row + 2 + evRow) + ';grid-column:' + (day + 1) + '"></div>');
          // 长按空白格子 = 在这个时间段快速新增（课程 / 考试讲座 / 把某天的课调过来）
          if (!mini) { bindEmptyCellLongPress(emptyCell, day, pIdx, U.addDays(monday, day - 1)); }
          table.appendChild(emptyCell);
          continue;
        }
        var span = Math.max(1, itemEndPeriod(hit) - itemStartPeriod(hit) + 1);
        if (row + span > rows) { span = rows - row; }
        for (var s2 = 0; s2 < span; s2++) { occupied[(row + s2) + '_' + day] = true; }
        var block;
        if (mini) {
          block = el('<div class="mg-block" style="grid-row:' + (row + 2 + evRow) + ' / span ' + span
            + ';grid-column:' + (day + 1) + ';background:' + hit.color + '"></div>');
        } else {
          // 用 background-color（不是 background 简写）：CSS 里那层淡淡的渐变才不会被清掉；
          // 同时按颜色亮度决定白字还是深色字
          block = el('<div class="wt-block ' + contrastClass(hit.color) + '" style="grid-row:' + (row + 2 + evRow) + ' / span ' + span
            + ';grid-column:' + (day + 1) + ';background-color:' + hit.color + '">'
            + '<span class="n">' + U.escapeHtml(hit.course.name) + '</span>'
            + (hit.location ? '<span class="l">' + U.escapeHtml(hit.location.raw) + '</span>' : '')
            + (hit.teachers.length ? '<span class="k">' + U.escapeHtml(hit.teachers.map(function (t) { return t.name; }).join('、')) + '</span>' : '')
            + '</div>');
        }
        (function (item) {
          block.addEventListener('click', function (ev) {
            if (mini) { ev.stopPropagation(); setExpanded('week'); return; }
            // v0.2.0：周表里点课程块 = 打开详细编辑器（星期 / 单双周 / 老师 / 地点…都能改）
            openBlockEditor(item);
          });
        })(hit);
        table.appendChild(block);
      }
    }
    table.__total = weekTotal;
    table.__rows = rows;
    return table;
  }

  /** 周表页：把整周表格塞进面板，行多时在面板内部滚动 */
  function renderWeekTable(sem) {
    var wrap = $('weekGridWrap');
    wrap.innerHTML = '';
    // 把可用高度交给 weekTableNode，让它按"一屏放下整周"来算行高
    var avail = Math.max(0, wrap.clientHeight - 4);
    var node = weekTableNode(sem, weekCursor, { fitH: avail });
    wrap.appendChild(node);
    /**
     * 二次校准：第一次按估算的表头高度算行高，插进 DOM 后如果还差几个像素，
     * 就按实际溢出量把行高压下去（不低于下限），保证"一屏放下整周"。
     */
    (function refit() {
      var over = wrap.scrollHeight - wrap.clientHeight;
      if (over <= 0) { return; }
      var rows = node.__rows || 0;
      if (!rows) { return; }
      var cur = parseFloat(getComputedStyle(node).getPropertyValue('--wt-row')) || 0;
      if (!cur) { return; }
      var next = Math.max(36, Math.floor(cur - Math.ceil(over / rows) - 1));
      if (next >= cur) { return; }
      node.style.setProperty('--wt-row', next + 'px');
      node.style.gridTemplateRows = node.style.gridTemplateRows.replace(/repeat\((\d+), \d+px\)/,
        'repeat($1, ' + next + 'px)');
      if (next < 44) { node.classList.add('wt-dense'); }
      if (next < 34) { node.classList.add('wt-tight'); }
    })();
    if (!node.__total) {
      wrap.appendChild(el('<div class="empty" style="padding:18px"><div class="t">这一周没有安排</div>'
        + '<div class="muted">用上面的周次条切换到别的周看看</div></div>'));
    }
    fadeInList(wrap, '.wt-block');
  }

  /* ── 周表长按空白格：快速新增 / 调休 ─────────────────────── */

  /**
   * 调休 / 借课：把来源日期的课整体搬到（或复制到）目标日期。
   *
   * 实现复用既有的"单次改动"覆盖表：
   *   移动 = 给来源日的每一节写一条 move 覆盖（newDate = 目标日）；
   *   复制 = 在目标日写一条 makeup 覆盖（保留来源日的课）。
   * 所以周表、今日页、冲突检测、导出配置全都会自然跟着变，不需要另开一套数据。
   */
  function openDayShift(presetSource) {
    var sem = AR.Store.currentSemester();
    var wrap = el('<div class="ds"></div>');
    var todayKey = U.dateKey(cursorDate || new Date());
    var srcKey = U.dateKey(presetSource || (weekCursor ? U.mondayOf(U.parseDateKey(sem ? sem.startDate : todayKey)) : new Date()));

    wrap.appendChild(el('<div class="field"><label class="field-label">来源日期（搬走哪天）</label>'
      + '<input class="input" type="date" id="dsSrc" value="' + srcKey + '"></div>'));
    wrap.appendChild(el('<div class="field"><label class="field-label">目标日期（搬到哪天）</label>'
      + '<input class="input" type="date" id="dsDst" value="' + U.dateKey(U.addDays(U.parseDateKey(srcKey), 7)) + '"></div>'));
    wrap.appendChild(el('<div class="field-label" style="margin-top:6px">方式</div>'));
    var modeWrap = el('<div class="segmented" id="dsMode"></div>');
    var modes = [
      { k: 'move', t: '搬过去（原日不再上课）' },
      { k: 'copy', t: '复制过去（两边都上）' }
    ];
    var mode = 'move';
    for (var i = 0; i < modes.length; i++) {
      (function (mo, idx) {
        var b = el('<button class="seg' + (idx === 0 ? ' active' : '') + '" type="button">' + mo.t + '</button>');
        b.addEventListener('click', function () {
          mode = mo.k;
          var all = modeWrap.querySelectorAll('.seg');
          for (var q = 0; q < all.length; q++) { all[q].classList.toggle('active', all[q] === b); }
          preview();
          AR.Bridge.haptic('light', b);
        });
        modeWrap.appendChild(b);
      })(modes[i], i);
    }
    wrap.appendChild(modeWrap);
    var previewBox = el('<div class="ds-preview"></div>');
    wrap.appendChild(previewBox);

    function preview() {
      var s = wrap.querySelector('#dsSrc').value;
      var d = wrap.querySelector('#dsDst').value;
      var sd = U.parseDateKey(s), dd = U.parseDateKey(d);
      if (!sd || !dd) { previewBox.innerHTML = '<span class="muted">选好两个日期</span>'; return; }
      var items = AR.Schedule.dayItems(sd, sem);
      var dstItems = AR.Schedule.dayItems(dd, sem);
      var html = '<div class="ds-line">' + (sd.getMonth() + 1) + '/' + sd.getDate()
        + '（' + U.WEEKDAY_NAMES[U.weekdayOf(sd)] + '）共 <b>' + items.length + '</b> 节课'
        + ' → ' + (dd.getMonth() + 1) + '/' + dd.getDate()
        + '（' + U.WEEKDAY_NAMES[U.weekdayOf(dd)] + '）';
      if (mode === 'move' && dstItems.length) {
        html += '<span class="ds-warn">目标那天原本有 ' + dstItems.length + ' 节课，可能会撞课</span>';
      }
      html += '</div>';
      if (items.length) {
        html += '<div class="ds-list">' + items.map(function (it) {
          return '<span class="ds-chip" style="background:' + it.color + '">' + U.escapeHtml(it.course.name) + '</span>';
        }).join('') + '</div>';
      } else {
        html += '<div class="muted">那天没有课</div>';
      }
      previewBox.innerHTML = html;
    }
    wrap.querySelector('#dsSrc').addEventListener('change', preview);
    wrap.querySelector('#dsDst').addEventListener('change', preview);
    preview();

    openModal({
      title: '调休 / 借课',
      sub: '按"单次改动"记录，只影响这两天，不动课程本身',
      body: wrap,
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: '执行', kind: 'primary',
          onClick: function (close) {
            var s = wrap.querySelector('#dsSrc').value;
            var d = wrap.querySelector('#dsDst').value;
            if (!s || !d) { toast('请选择两个日期'); return; }
            if (s === d) { toast('来源和目标不能是同一天'); return; }
            var sd = U.parseDateKey(s), dd = U.parseDateKey(d);
            var items = AR.Schedule.dayItems(sd, sem);
            if (!items.length) { toast('那天没有课'); return; }
            var done = 0;
            for (var k = 0; k < items.length; k++) {
              var it = items[k];
              if (mode === 'move') {
                // 和"单节课改星期"用的是同一套记录方式：
                // 目标日一条 move（带上新的星期），来源日一条 cancel（原课不再显示）
                AR.Store.upsertOverride(it.blockId, it.courseId, d, {
                  type: 'move', newDate: d, newWeekday: U.weekdayOf(dd), reason: '调休'
                });
                if (it.kind === 'normal') {
                  AR.Store.upsertOverride(it.blockId, it.courseId, s, { type: 'cancel', newDate: null, reason: '调休' });
                } else if (it.override && it.kind !== 'moved-in') {
                  AR.Store.removeOverride(it.override.id);
                }
              } else {
                AR.Store.upsertOverride(it.blockId, it.courseId, d, {
                  type: 'makeup', newPeriodStart: itemStartPeriod(it), newPeriodEnd: itemEndPeriod(it),
                  newStartTime: it.start || '', newEndTime: it.end || '',
                  newLocationIds: it.location ? [it.location.id] : [], newNote: it.note || '', reason: '借课'
                });
              }
              done++;
            }
            AR.Bridge.haptic('medium', wrap);
            close();
            renderWeek();
            renderToday();
            toast((mode === 'move' ? '已把 ' : '已复制 ') + done + ' 节课'
              + (mode === 'move' ? '搬到 ' : '到 ') + (dd.getMonth() + 1) + '/' + dd.getDate());
          }
        }
      ]
    });
  }

  /**
   * 长按 480ms 弹「快速新增」。用 pointerdown + 位移/滚动取消，
   * 手机上滑动表格时不会误触。
   */
  function bindEmptyCellLongPress(cell, weekday, periodIdx, date) {
    if (!cell || !cell.addEventListener) { return; }
    var timer = null;
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; cell.classList.remove('lp-wait'); }
    }
    cell.addEventListener('pointerdown', function (ev) {
      cancel();
      var x0 = ev.clientX, y0 = ev.clientY;
      cell.classList.add('lp-wait');
      timer = setTimeout(function () {
        timer = null;
        cell.classList.remove('lp-wait');
        AR.Bridge.haptic('medium', cell);
        openQuickAdd(weekday, periodIdx, date);
      }, 480);
      var move = function (e2) {
        if (Math.abs(e2.clientX - x0) > 10 || Math.abs(e2.clientY - y0) > 10) { cancel(); }
      };
      var up = function () {
        cancel();
        cell.removeEventListener('pointermove', move);
        cell.removeEventListener('pointerup', up);
        cell.removeEventListener('pointercancel', up);
      };
      cell.addEventListener('pointermove', move);
      cell.addEventListener('pointerup', up);
      cell.addEventListener('pointercancel', up);
    });
    cell.addEventListener('pointerleave', cancel);
    cell.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  }

  /** 快速新增面板：课程 / 特殊事件，都预填好刚长按的星期与节次 */
  function openQuickAdd(weekday, periodIdx, date) {
    var sem = AR.Store.currentSemester();
    var dateText = (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日 · ' + U.WEEKDAY_NAMES[weekday];
    var wrap = el('<div class="qa"></div>');
    var modeRow = el('<div class="segmented qa-mode"></div>');
    var mode = 'course';
    var modes = [{ k: 'course', t: '新增课程' }, { k: 'event', t: '考试 / 讲座' }];
    var panes = {};

    // —— 课程 ——
    var coursePane = el('<div class="qa-pane"></div>');
    coursePane.appendChild(el('<div class="field"><label class="field-label">课程名</label>'
      + '<input class="input" id="qaName" placeholder="例如 高等数学A" autocomplete="off"></div>'));
    coursePane.appendChild(el('<div class="field"><label class="field-label">节次</label>'
      + '<div class="row"><input class="input" type="number" min="1" max="20" id="qaP1" style="flex:1 1 0" value="' + periodIdx + '">'
      + '<span class="muted edit-sep">到</span>'
      + '<input class="input" type="number" min="1" max="20" id="qaP2" style="flex:1 1 0" value="' + periodIdx + '"></div></div>'));
    coursePane.appendChild(el('<div class="field"><label class="field-label">周次</label>'
      + '<input class="input" id="qaWeeks" value="全周" placeholder="全周 / 单周 / 双周 / 1-16"></div>'));
    coursePane.appendChild(el('<div class="field"><label class="field-label">地点（可空）</label>'
      + '<input class="input" id="qaPlace" placeholder="例如 信息楼 305"></div>'));
    coursePane.appendChild(el('<div class="field"><label class="field-label">老师（可空）</label>'
      + '<input class="input" id="qaTeacher"></div>'));
    coursePane.appendChild(el('<div class="field"><label class="field-label">颜色</label><div class="swatches" id="qaColors"></div></div>'));
    panes.course = coursePane;

    // —— 特殊事件 ——
    var evPane = el('<div class="qa-pane" hidden></div>');
    evPane.appendChild(el('<div class="field"><label class="field-label">标题</label>'
      + '<input class="input" id="qaEvTitle" placeholder="例如 高等数学 期中考试"></div>'));
    evPane.appendChild(el('<div class="field"><label class="field-label">类型</label>'
      + '<div class="segmented" id="qaEvType"></div></div>'));
    evPane.appendChild(el('<div class="field"><label class="field-label">时间（可空）</label>'
      + '<div class="row"><input class="input" type="time" id="qaEvStart" style="flex:1 1 0">'
      + '<span class="muted edit-sep">到</span>'
      + '<input class="input" type="time" id="qaEvEnd" style="flex:1 1 0"></div></div>'));
    evPane.appendChild(el('<div class="field"><label class="field-label">地点 / 备注（可空）</label>'
      + '<input class="input" id="qaEvPlace"></div>'));
    panes.event = evPane;

    for (var m = 0; m < modes.length; m++) {
      (function (mo) {
        var b = el('<button class="seg' + (mo.k === mode ? ' active' : '') + '" type="button">' + mo.t + '</button>');
        b.addEventListener('click', function () {
          mode = mo.k;
          var btns = modeRow.querySelectorAll('.seg');
          for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle('active', btns[i] === b); }
          panes.course.hidden = (mode !== 'course');
          panes.event.hidden = (mode !== 'event');
          AR.Bridge.haptic('light', b);
        });
        modeRow.appendChild(b);
      })(modes[m]);
    }
    wrap.appendChild(el('<p class="muted" style="margin:0 0 10px">' + dateText + ' · 第 ' + periodIdx + ' 节'
      + (sem ? ' · ' + U.escapeHtml(sem.name) : '') + '</p>'));
    wrap.appendChild(modeRow);
    wrap.appendChild(coursePane);
    wrap.appendChild(evPane);

    var picked = U.PALETTE[0].hex;
    var colorBox = coursePane.querySelector('#qaColors');
    for (var ci = 0; ci < U.PALETTE.length; ci++) {
      (function (p, idx) {
        var sw = el('<button type="button" class="swatch' + (idx === 0 ? ' active' : '')
          + '" data-color="' + p.hex + '" title="' + p.name + '" style="background:' + p.hex + '"></button>');
        sw.addEventListener('click', function () {
          picked = p.hex;
          var all = colorBox.querySelectorAll('.swatch');
          for (var i = 0; i < all.length; i++) { all[i].classList.toggle('active', all[i] === sw); }
          AR.Bridge.haptic('light', sw);
        });
        colorBox.appendChild(sw);
      })(U.PALETTE[ci], ci);
    }
    var more = el('<button type="button" class="swatch custom" title="更多颜色">＋</button>');
    more.addEventListener('click', function () {
      openColorPicker(picked, function (hex) { picked = hex; AR.UI.toast('已选 ' + hex); });
    });
    colorBox.appendChild(more);

    // 事件类型
    var typeBox = evPane.querySelector('#qaEvType');
    var evType = 'exam';
    var types = AR.Store.EVENT_TYPES || [];
    for (var ti = 0; ti < types.length; ti++) {
      (function (t, idx) {
        var b = el('<button class="seg' + (idx === 0 ? ' active' : '') + '" type="button">' + t.label + '</button>');
        b.addEventListener('click', function () {
          evType = t.key;
          var all = typeBox.querySelectorAll('.seg');
          for (var i = 0; i < all.length; i++) { all[i].classList.toggle('active', all[i] === b); }
        });
        typeBox.appendChild(b);
      })(types[ti], ti);
    }

    openModal({
      title: '快速新增', sub: dateText + ' · 第 ' + periodIdx + ' 节',
      body: wrap,
      actions: [
        { label: '取消', onClick: function (close) { close(); } },
        {
          label: '保存', kind: 'primary',
          onClick: function (close) {
            if (mode === 'course') {
              var name = (wrap.querySelector('#qaName').value || '').trim();
              if (!name) { toast('请先填课程名'); return; }
              var res = AR.Panels.quickAddCourse({
                name: name, weekday: weekday,
                p1: wrap.querySelector('#qaP1').value, p2: wrap.querySelector('#qaP2').value,
                weeks: wrap.querySelector('#qaWeeks').value,
                place: wrap.querySelector('#qaPlace').value,
                teacher: wrap.querySelector('#qaTeacher').value,
                color: picked
              });
              if (!res.ok) { toast(res.message || '保存失败'); return; }
              if (res.periodsAdded) { toast('已自动补 ' + res.periodsAdded + ' 个节次'); }
              else { toast('已添加：' + name); }
            } else {
              var title = (wrap.querySelector('#qaEvTitle').value || '').trim();
              if (!title) { toast('请先填标题'); return; }
              var r2 = AR.Panels.quickAddEvent({
                title: title, type: evType, date: U.dateKey(date),
                start: wrap.querySelector('#qaEvStart').value, end: wrap.querySelector('#qaEvEnd').value,
                place: wrap.querySelector('#qaEvPlace').value
              });
              if (!r2.ok) { toast(r2.message || '保存失败'); return; }
              toast('已添加：' + title);
            }
            AR.Bridge.haptic('medium', wrap);
            close();
            renderWeek();
            renderToday();
          }
        }
      ]
    });
    var focus = wrap.querySelector('#qaName');
    if (focus) { try { focus.focus(); } catch (e) { } }
  }

  /** 课程块落在第几节开始 / 结束（用时间反查节次，兼容调课改时间） */
  /**
   * 课块文字用白字还是深色字：按颜色亮度自动选。
   * 以前一律白字，遇到琥珀 / 竹青这种偏亮的颜色就发飘、读起来费劲。
   * 阈值 0.62（近似感知亮度），交界的颜色会自动落到对比更好的一侧。
   */
  function contrastClass(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    if (h.length !== 6) { return 'lt'; }
    var toLin = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var r = toLin(parseInt(h.substring(0, 2), 16) / 255);
    var g = toLin(parseInt(h.substring(2, 4), 16) / 255);
    var b = toLin(parseInt(h.substring(4, 6), 16) / 255);
    var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    /**
     * 白字对比度 = 1.05 / (L + 0.05)。
     * ≥3.0 就继续用白字（彩色底 + 白字是课表的习惯观感，粗体下 3:1 也达标）；
     * 达不到就换深色字 —— 琥珀、暖橙、苔绿这类偏亮的颜色会因此改善很多。
     */
    var contrastWhite = 1.05 / (lum + 0.05);
    return contrastWhite >= 3.0 ? 'lt' : 'dk';
  }

  function itemStartPeriod(item) {
    var sem = AR.Store.currentSemester();
    var ps = AR.Store.periodsOf(sem ? sem.id : null);
    if (item.start) {
      for (var i = 0; i < ps.length; i++) { if (ps[i].start === item.start) { return ps[i].index; } }
    }
    return item.block.periodStart || 1;
  }

  function itemEndPeriod(item) {
    var sem = AR.Store.currentSemester();
    var ps = AR.Store.periodsOf(sem ? sem.id : null);
    if (item.end) {
      for (var i = 0; i < ps.length; i++) { if (ps[i].end === item.end) { return ps[i].index; } }
    }
    return item.block.periodEnd || item.block.periodStart || 1;
  }

  /** 某 item 在节次表里的行下标 */
  function periodIndexIn(periods, item) {
    for (var i = 0; i < periods.length; i++) {
      if (item.start && periods[i].start === item.start) { return i; }
    }
    for (var j = 0; j < periods.length; j++) {
      if (periods[j].index === item.block.periodStart) { return j; }
    }
    return -1;
  }

  function shortPlace(s) {
    var t = String(s || '');
    return t.length > 10 ? t.slice(0, 10) + '…' : t;
  }

  /* ── 弹窗 ─────────────────────────────────────────────────── */

  var modalStack = [];
  var modalCloseTimer = null;

  /* ── 统一的弹层动效（v0.2.5）───────────────────────────────
     以前每个弹窗靠 CSS 类切换 + 各自的 transition，卡片大小 /
     布局（普通卡片 vs 宽卡片 flex 布局）不一样时，观感就不一致：
     今日页「时间」弹窗和周表「课程」弹窗进出场明显不同步。

     现在全部由这里的两个函数驱动：同一套关键帧（位移 + 缩放 + 淡入）、
     同一条非线性曲线、同一时长，任何弹窗（大的小的、有表单没表单）
     进出场完全一致。CSS 里的 transition 全部让位（置 none）。
     ─────────────────────────────────────────────────────────── */

  var POP_IN_EASE = 'cubic-bezier(.16, 1, .30, 1)';     // 强缓出
  var POP_OUT_EASE = 'cubic-bezier(.40, 0, .80, .60)';  // 缓入
  var POP_IN_MS = 300;
  var POP_OUT_MS = 190;

  function motionSpeed() {
    var speed = Number((S && S.settings && S.settings.appearance
      && S.settings.appearance.animationSpeed) || 1) || 1;
    return speed;
  }

  /** 弹层时长（跟随设置里的「动画速度」） */
  function modalDur(kind) {
    var base = kind === 'out' ? POP_OUT_MS : POP_IN_MS;
    return Math.max(90, Math.round(base / motionSpeed()));
  }

  function stopModalAnim(node) {
    if (!node) { return; }
    if (node.__popAnim) {
      try { node.__popAnim.cancel(); } catch (e) { }
      node.__popAnim = null;
    }
    node.style.opacity = '';
    node.style.transform = '';
  }

  /**
   * 给其它浮层（首次引导卡片等）复用同一套进场动画，
   * 这样「弹窗 / 引导 / 抽屉」的进出场观感完全一致。
   */
  function popIn(node, kind) {
    if (!node || !node.animate) { return; }
    var dir = kind === 'out' ? 'out' : 'in';
    var m = AR.Motion ? AR.Motion.dir('modal', dir === 'out' ? 'out' : 'in') : null;
    var dur = m ? Math.round(m.dur / motionSpeed()) : modalDur(dir);
    var ease = AR.Motion ? AR.Motion.ease(m && m.ease) : (dir === 'out' ? POP_OUT_EASE : POP_IN_EASE);
    try { if (node.__popAnim) { node.__popAnim.cancel(); } } catch (e) { }
    node.style.transition = 'none';
    var from, to;
    if (AR.Motion) {
      from = dir === 'out' ? AR.Motion.pose(null) : AR.Motion.pose(m && m.from);
      to = dir === 'out' ? AR.Motion.pose(m && m.to) : AR.Motion.pose(null);
    } else {
      from = dir === 'out'
        ? { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
        : { opacity: 0, transform: 'translate3d(0,14px,0) scale(.94)' };
      to = dir === 'out'
        ? { opacity: 0, transform: 'translate3d(0,6px,0) scale(.975)' }
        : { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' };
    }
    node.__popAnim = node.animate([from, to], {
      duration: dur, easing: ease, fill: dir === 'out' ? 'forwards' : 'both'
    });
  }

  /**
   * 播放弹层进出场。card 与遮罩用同一时长、同一曲线，保证"一起动"。
   * 不支持 WAAPI 的老 WebView：退回 CSS 类（transition 已在 CSS 里定义好）。
   */
  function playModal(root, card, dir) {
    var scrim = $('modalScrim');
    /**
     * 弹窗进/退场：姿势（位移/缩放/旋转/模糊）和曲线时长都来自 AR.Motion，
     * 开发者模式里换一个样式，今日页时间弹窗、周表课程弹窗、引导卡片一起变。
     */
    var m = AR.Motion ? AR.Motion.dir('modal', dir === 'out' ? 'out' : 'in') : null;
    var dur = m ? Math.round(m.dur / motionSpeed()) : modalDur(dir);
    var ease = AR.Motion ? AR.Motion.ease(m && m.ease) : (dir === 'out' ? POP_OUT_EASE : POP_IN_EASE);
    var canAnimate = !!(card && card.animate && !window.__noWaapi) && dur > 0;

    if (!canAnimate) {
      if (card) { card.style.transition = ''; }
      if (scrim) { scrim.style.transition = ''; }
      if (dir === 'out') { root.classList.remove('open'); root.classList.add('closing'); }
      else { root.classList.remove('closing'); root.classList.add('open'); }
      return;
    }

    stopModalAnim(card);
    stopModalAnim(scrim);
    if (card) { card.style.transition = 'none'; }
    if (scrim) { scrim.style.transition = 'none'; }
    root.classList.remove('closing');
    root.classList.add('open');

    var from = dir === 'out'
      ? { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
      : { opacity: 0, transform: 'translate3d(0,14px,0) scale(.94)' };
    var to = dir === 'out'
      ? { opacity: 0, transform: 'translate3d(0,6px,0) scale(.975)' }
      : { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' };

    if (card) {
      if (AR.Motion) {
        if (dir === 'out') {
          from = AR.Motion.pose(null);
          to = AR.Motion.pose(m && m.to);
        } else {
          from = AR.Motion.pose(m && m.from);
          to = AR.Motion.pose(null);
        }
      }
      if (m && m.origin) { card.style.transformOrigin = m.origin; }
      /**
       * 磁贴翻转的弹窗：轴放在"你点的那一侧"。
       * 点右半屏 → 弹窗以右边缘为轴、从右往左翻开；配合 ry 的 3D 旋转，
       * 和今日页的磁贴翻转是同一种语言。
       */
      if (m && m.origin === 'click') {
        var cr = card.getBoundingClientRect();
        var px = (lastPointer.x || 0) - cr.left;
        var side = (!cr.width || px < cr.width / 2) ? 'left' : 'right';
        card.style.transformOrigin = (side === 'left' ? '0%' : '100%') + ' 50%';
        var sign = (side === 'left' ? -1 : 1);
        if (dir === 'out') {
          to = AR.Motion.pose({ o: 0, ry: sign * 88, s: .96 });
        } else {
          from = AR.Motion.pose({ o: 0, ry: sign * 96, s: .92 });
          to = AR.Motion.pose(null);
        }
      }
      card.__popAnim = card.animate([from, to], {
        duration: dur, easing: ease, fill: dir === 'out' ? 'forwards' : 'both'
      });
      if (dir !== 'out' && m && m.childStagger) {
        playModalChildren(card, m, dur);
      }
    }
    if (scrim) {
      scrim.__popAnim = scrim.animate(
        [{ opacity: dir === 'out' ? 1 : 0 }, { opacity: dir === 'out' ? 0 : 1 }],
        { duration: Math.round(dur * 0.9), easing: ease, fill: dir === 'out' ? 'forwards' : 'both' }
      );
    }
  }

  /** 弹窗内容的"逐条拼合"：进场的卡片里，各块内容再错峰落位 */
  function playModalChildren(card, m, dur) {
    var kids = card.querySelectorAll('.modal-head, .modal-body > *, .modal-actions');
    var gap = Math.round((m.childStagger || 40) / motionSpeed());
    var speed = motionSpeed();
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!k.animate) { continue; }
      if (k.__fx) { try { k.__fx.cancel(); } catch (e) { } k.__fx = null; }
      k.__fx = k.animate(
        [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.985)' }, { opacity: 1, transform: 'none' }],
        { duration: Math.round(260 / speed), delay: i * gap, easing: AR.Motion.ease('expo'), fill: 'backwards' }
      );
      k.__fx.onfinish = (function (n) { return function () { n.__fx = null; }; })(k);
    }
  }

  function openModal(opts) {
    var root = $('modalRoot');
    var card = $('modalCard');
    if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }
    root.classList.remove('closing');
    // 表单类弹窗（课程编辑）要宽一点，普通弹窗保持窄卡片
    card.classList[opts.wide ? 'add' : 'remove']('modal-wide');
    card.innerHTML = '';
    var head = el('<div class="modal-head"><div><h3 class="modal-title">' + U.escapeHtml(opts.title || '') + '</h3>'
      + (opts.sub ? '<p class="modal-sub">' + U.escapeHtml(opts.sub) + '</p>' : '') + '</div>'
      + '<button class="modal-close" type="button">✕</button></div>');
    head.querySelector('.modal-close').addEventListener('click', closeModal);
    card.appendChild(head);
    var bodyNode = el('<div class="modal-body"></div>');
    if (typeof opts.body === 'string') { bodyNode.innerHTML = opts.body; }
    else if (opts.body) { bodyNode.appendChild(opts.body); }
    card.appendChild(bodyNode);
    if (opts.actions && opts.actions.length) {
      var actions = el('<div class="modal-actions"></div>');
      for (var i = 0; i < opts.actions.length; i++) {
        (function (a) {
          var b = el('<button class="btn ' + (a.kind || '') + '" type="button">' + U.escapeHtml(a.label) + '</button>');
          b.addEventListener('click', function () {
            AR.Bridge.haptic(a.kind === 'danger' ? 'warn' : 'light', $('modalCard'));
            a.onClick && a.onClick(closeModal);
          });
          actions.appendChild(b);
        })(opts.actions[i]);
      }
      card.appendChild(actions);
    }
    root.hidden = false;
    /**
     * v0.2.0 修复：弹窗内容永远是原地替换（同一张卡片），
     * 所以栈里只能留最后一个 —— 之前从「课程详情」再开「设置颜色」时，
     * 选完颜色关闭只会弹掉一层，卡片变透明但没隐藏，
     * 全屏遮罩留在地面上，点哪里都没反应。
     */
    modalStack.length = 0;
    modalStack.push(opts);
    playModal(root, card, 'in');
    // 只震动、不再给卡片加视觉脉冲：脉冲的 scale 会和上面的进场动画抢 transform
    AR.Bridge.haptic('light', false);
  }

  function closeModal() {
    var root = $('modalRoot');
    if (root.hidden) { return false; }
    modalStack.pop();
    playModal(root, $('modalCard'), 'out');
    if (modalCloseTimer) { clearTimeout(modalCloseTimer); }
    modalCloseTimer = setTimeout(function () {
      modalCloseTimer = null;
      root.classList.remove('closing');
      stopModalAnim($('modalCard'));
      stopModalAnim($('modalScrim'));
      if (!modalStack.length) { root.hidden = true; }
    }, modalDur('out') + 24);
    return true;
  }

  /* ══════════════════════════════════════════════════════════════
     单个时段编辑器（v0.2.0）
     今日页「最近的课」里的位置 / 节次 / 时间 / 老师 / 备注，
     以及周表里点课程块，都走这一个窗口：
       课程名 · 老师 · 地点 · 星期 · 节次 · 时间 · 单双周/周次 · 备注 · 颜色
     默认写回这门课的排课（所有周生效）；如果这一天本来就有
     「调课 / 换教室 / 换时间 / 补课」记录，顶部会出现范围开关，
     默认「仅这一次」，只改当天的这一节。
     ══════════════════════════════════════════════════════════════ */

  /** "张三、李四，王五" → ["张三","李四","王五"] */
  function splitTeacherNames(s) {
    var parts = String(s == null ? '' : s).replace(/[，,、;；/|]+/g, '|').split('|');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].trim();
      if (v && out.indexOf(v) < 0) { out.push(v); }
    }
    return out;
  }

  function openBlockEditor(item, opts) {
    opts = opts || {};
    var sem = AR.Store.currentSemester();
    var weekCount = sem ? sem.weekCount : 20;
    var periods = AR.Store.periodsOf(sem ? sem.id : null);
    var block = item.block;
    var course = item.course;
    var day = item.date || new Date();
    var realBlock = AR.Store.blockById ? AR.Store.blockById(block.id) : null;
    // 补课 / 加课这种「单次课」没有模板 block，只能按"这一次"改
    var hasOneOff = (!!item.override && item.kind !== 'normal') || !realBlock;
    var scope = hasOneOff ? 'once' : 'all';
    var pickedColor = course.colorKey;
    var dayShort = (day.getMonth() + 1) + '/' + day.getDate();

    function periodDefault(idx, which) {
      for (var i = 0; i < periods.length; i++) {
        if (periods[i].index === Number(idx)) { return which === 'end' ? periods[i].end : periods[i].start; }
      }
      return '';
    }
    function periodOptions(sel) {
      var out = '';
      for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        out += '<option value="' + p.index + '"' + (Number(sel) === p.index ? ' selected' : '') + '>'
          + '第 ' + p.index + ' 节　' + U.escapeHtml(p.start) + '-' + U.escapeHtml(p.end) + '</option>';
      }
      return out;
    }

    var startPeriod = block.periodStart || 1;
    var endPeriod = block.periodEnd || startPeriod;
    var curStart = item.start || block.startTime || periodDefault(startPeriod, 'start');
    var curEnd = item.end || block.endTime || periodDefault(endPeriod, 'end');
    var weekMode = (block.weekMode === 'odd' || block.weekMode === 'even' || block.weekMode === 'custom')
      ? block.weekMode : 'all';
    var weekText = AR.Store.weeksText ? AR.Store.weeksText(block, weekCount) : '全周';

    var weekdayOpts = '';
    for (var w = 1; w <= 7; w++) {
      weekdayOpts += '<option value="' + w + '"' + (block.weekday === w ? ' selected' : '') + '>'
        + U.WEEKDAY_NAMES[w] + '</option>';
    }

    var swatchHtml = '';
    for (var pi = 0; pi < U.PALETTE.length; pi++) {
      swatchHtml += '<button type="button" class="swatch' + (U.PALETTE[pi].key === pickedColor ? ' active' : '')
        + '" data-color="' + U.PALETTE[pi].key + '" title="' + U.PALETTE[pi].name
        + '" style="background:' + U.PALETTE[pi].hex + '"></button>';
    }
    // 自定义颜色（色盘）：存 #RRGGBB，和调色板走同一套 colorKey
    var customHex = /^#[0-9a-fA-F]{6}$/.test(String(pickedColor)) ? pickedColor : '#5B8DEF';
    var customSwatch = /^#[0-9a-fA-F]{6}$/.test(String(pickedColor))
      ? '<button type="button" class="swatch custom active" data-color="' + customHex
        + '" title="自定义" style="background:' + customHex + '"></button>'
      : '<button type="button" class="swatch custom" data-color="' + customHex
        + '" title="自定义" style="background:' + customHex + '"></button>';

    var teacherText = item.teachers.length
      ? item.teachers.map(function (t) { return t.name; }).join('、') : '';

    var body = el('<div class="edit-form">'
      + '<div class="zone-tools editor-tools" id="ebTools">'
      + '<button class="chip-btn" type="button" data-act="cal">加入系统日历</button>'
      + '<button class="chip-btn" type="button" data-act="alarm">设置闹钟</button>'
      + '<button class="chip-btn" type="button" data-act="nav">打开导航</button>'
      + '</div>'
      + (hasOneOff
        ? '<div class="scope-switch" id="ebScope">'
          + '<button type="button" class="scope-btn active" data-scope="once">仅这次 · ' + U.escapeHtml(dayShort) + '</button>'
          + (realBlock ? '<button type="button" class="scope-btn" data-scope="all">这门课的所有时段</button>' : '')
          + '<span class="scope-hint" id="ebScopeHint">只改当天的这一节，其它周不动</span></div>'
        : '')
      + '<div class="edit-grid">'
      + '<div class="field"><label class="field-label">课程名</label>'
      + '<input class="input" id="ebName" value="' + U.escapeHtml(course.name) + '">'
      + '<div class="muted" style="margin-top:4px">改成已有课程名会自动合并，并统一成同一个颜色</div></div>'
      + '<div class="field"><label class="field-label">老师</label>'
      + '<input class="input" id="ebTeachers" placeholder="多个老师用、分隔" value="'
      + U.escapeHtml(teacherText) + '"></div>'
      + '<div class="field"><label class="field-label">地点</label>'
      + '<input class="input" id="ebPlace" placeholder="如：XX大学 信息楼 305" value="'
      + U.escapeHtml(item.location ? item.location.raw : '') + '"></div>'
      + '<div class="field"><label class="field-label">星期</label>'
      + '<select class="input" id="ebWeekday">' + weekdayOpts + '</select></div>'
      + '<div class="field edit-span"><label class="field-label">节次（第几节到第几节）</label>'
      + '<div class="row"><select class="input" id="ebPStart" style="flex:1 1 0">' + periodOptions(startPeriod) + '</select>'
      + '<span class="muted edit-sep">到</span>'
      + '<select class="input" id="ebPEnd" style="flex:1 1 0">' + periodOptions(endPeriod) + '</select></div></div>'
      + '<div class="field edit-span"><label class="field-label">上课时间</label>'
      + '<div class="row"><input class="input" type="time" id="ebStart" style="flex:1 1 0" value="' + U.escapeHtml(curStart) + '">'
      + '<span class="muted edit-sep">到</span>'
      + '<input class="input" type="time" id="ebEnd" style="flex:1 1 0" value="' + U.escapeHtml(curEnd) + '"></div>'
      + '<div class="muted" style="margin-top:4px">跟着节次自动填；改了这里只影响这门课，不动整张节次表</div></div>'
      + '<div class="field" id="ebWeekField"><label class="field-label">上课周次</label>'
      + '<div class="row"><select class="input" id="ebWeekMode" style="flex:0 0 120px">'
      + '<option value="all"' + (weekMode === 'all' ? ' selected' : '') + '>每周</option>'
      + '<option value="odd"' + (weekMode === 'odd' ? ' selected' : '') + '>单周</option>'
      + '<option value="even"' + (weekMode === 'even' ? ' selected' : '') + '>双周</option>'
      + '<option value="custom"' + (weekMode === 'custom' ? ' selected' : '') + '>自定义</option></select>'
      + '<input class="input" id="ebWeeks" style="flex:1 1 150px" placeholder="例如 1-8,10,12" value="'
      + U.escapeHtml(weekMode === 'custom' ? weekText : '') + '"></div>'
      + '<div class="muted" style="margin-top:4px">单双周也可以配合周次范围，如选「单周」再填 1-16</div></div>'
      + '<div class="field"><label class="field-label">备注</label>'
      + '<textarea class="input" id="ebNote" rows="3" placeholder="考试范围 / 作业 / 答疑时间…">'
      + U.escapeHtml(item.note || '') + '</textarea></div>'
      + '<div class="field edit-span"><label class="field-label">课程颜色</label>'
      + '<div class="swatches" id="ebColors">' + swatchHtml + '</div>'
      + '<div class="row color-custom">'
      + '<button class="btn color-open" type="button" id="ebColorPick">'
      + '<span class="co-dot" id="ebColorDot" style="background:' + customHex + '"></span>打开色盘</button>'
      + '<span class="muted">饱和/明度方块 + 色相条，也能直接填 #RRGGBB</span></div></div>'
      + '<div class="field edit-span"><label class="field-label">课程类型（影响配色方案）</label>'
      + '<select class="input" id="ebTrack">'
      + '<option value="">自动识别（按课程名）</option>'
      + (AR.Palette ? AR.Palette.tracks.map(function (t) {
        return '<option value="' + t.key + '"' + (item.course.track === t.key ? ' selected' : '') + '>'
          + t.label + '</option>';
      }).join('') : '')
      + '</select>'
      + '<div class="muted" style="margin-top:4px" id="ebTrackHint">当前识别为：'
      + (AR.Palette ? AR.Palette.trackLabel(AR.Palette.trackOf(item.course)) : '—')
      + '；在设置 → 课程与课表 里可以一键按类型重排颜色</div></div>'
      + '</div>'
      + '<div class="muted" id="ebHint">保存后：改名 / 换色对整门课生效；星期、节次、时间、地点、老师、备注按上面选的范围生效。</div>'
      + '</div>');

    /* 周表里点开课程后，也能直接加日程 / 设闹钟 / 打开导航 ——
       数据用的是「这一次课」的日期与时间（不是模板）。 */
    (function wireEditorTools() {
      var tools = body.querySelector('#ebTools');
      if (!tools) { return; }
      var startMs = toMs(day, item.start);
      var endMs = toMs(day, item.end) || (startMs ? startMs + 45 * 60000 : null);
      var place = item.location ? item.location.raw : '';
      tools.querySelector('[data-act="cal"]').addEventListener('click', function () {
        if (!startMs) { toast('这节课还没有时间，先在下面设好节次'); return; }
        AR.Bridge.addCalendarEvent(item.course.name, place,
          'Abbey Road 课表 · ' + (item.periodLabel || '') + (item.note ? ' · ' + item.note : ''),
          startMs, endMs || (startMs + 45 * 60000));
        AR.Bridge.haptic('medium', tools);
      });
      tools.querySelector('[data-act="alarm"]').addEventListener('click', function () {
        var hm = String(item.start || '08:00').split(':');
        AR.Bridge.setAlarm(Number(hm[0]), Number(hm[1]), item.course.name + (place ? ' ' + place : ''));
        AR.Bridge.haptic('medium', tools);
      });
      tools.querySelector('[data-act="nav"]').addEventListener('click', function () {
        var q = AR.Location.navQuery(place, S.settings).query;
        if (!q) { toast('这节课还没有地点'); return; }
        AR.Bridge.openMap(S.settings.integration.navApp, q, AR.Location.navWebUrl(q, S.settings.integration.navApp));
        AR.Bridge.haptic('medium', tools);
      });
    })();

    var scopeBtns = body.querySelectorAll ? body.querySelectorAll('.scope-btn') : [];
    function applyScope(next) {
      scope = next;
      for (var i = 0; i < scopeBtns.length; i++) {
        scopeBtns[i].classList[scopeBtns[i].getAttribute('data-scope') === scope ? 'add' : 'remove']('active');
      }
      var hint = body.querySelector('#ebScopeHint');
      if (hint) {
        hint.textContent = scope === 'once' ? '只改当天的这一节，其它周不动' : '改动会写进这门课的所有时段';
      }
      var weekField = body.querySelector('#ebWeekField');
      if (weekField) {
        var off = scope === 'once';
        weekField.classList[off ? 'add' : 'remove']('disabled');
        var ws = body.querySelector('#ebWeekMode');
        var wt = body.querySelector('#ebWeeks');
        if (ws) { ws.disabled = off; }
        if (wt) { wt.disabled = off; }
      }
      var hint2 = body.querySelector('#ebHint');
      if (hint2) {
        hint2.textContent = scope === 'once'
          ? '保存后：改名 / 换色对整门课生效；星期、节次、时间、地点、老师、备注只改这一天。'
          : '保存后：所有没被单独调整过的周都会跟着变。';
      }
    }
    for (var si = 0; si < scopeBtns.length; si++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          applyScope(btn.getAttribute('data-scope'));
          AR.Bridge.haptic('light', btn);
        });
      })(scopeBtns[si]);
    }

    var swatchBtns = body.querySelectorAll ? body.querySelectorAll('#ebColors .swatch') : [];
    for (var sj = 0; sj < swatchBtns.length; sj++) {
      (function (sw) {
        sw.addEventListener('click', function () {
          pickedColor = sw.getAttribute('data-color');
          for (var q = 0; q < swatchBtns.length; q++) {
            swatchBtns[q].classList[swatchBtns[q] === sw ? 'add' : 'remove']('active');
          }
          var pick = body.querySelector('#ebColorPick');
          if (pick && /^#[0-9a-fA-F]{6}$/.test(String(pickedColor))) { pick.value = pickedColor; }
          AR.Bridge.haptic('light', sw);
        });
      })(swatchBtns[sj]);
    }
    /**
     * 取色：自己画的色盘（HSV 方块 + 色相条 + 十六进制 + 最近使用）。
     * 原生 <input type="color"> 在手机上各家系统界面都不一样，而且没法给推荐色，
     * 换成统一的自绘面板后，双端观感一致、也能一键挑"白字读得清"的颜色。
     */
    var colorPick = body.querySelector('#ebColorPick');
    if (colorPick) {
      colorPick.addEventListener('click', function () {
        openColorPicker(pickedColor || item.color, function (hex) {
          pickedColor = hex;
          var dot = body.querySelector('#ebColorDot');
          if (dot) { dot.style.background = hex; }
          for (var q = 0; q < swatchBtns.length; q++) { swatchBtns[q].classList.remove('active'); }
          for (var r = 0; r < swatchBtns.length; r++) {
            if (String(swatchBtns[r].getAttribute('data-color')).toLowerCase() === String(hex).toLowerCase()) {
              swatchBtns[r].classList.add('active');
            }
          }
          AR.Bridge.haptic('light', colorPick);
        });
      });
    }
    // 课程类型：改完立刻把提示刷新，保存时写进 course.track
    var trackSel = body.querySelector('#ebTrack');
    if (trackSel) {
      trackSel.addEventListener('change', function () {
        var hint = body.querySelector('#ebTrackHint');
        var auto = AR.Palette ? AR.Palette.trackLabel(AR.Palette.inferTrack(item.course.name)) : '—';
        var picked = trackSel.value ? AR.Palette.trackLabel(trackSel.value) : '自动识别（' + auto + '）';
        if (hint) { hint.textContent = '当前识别为：' + picked + '；保存后按这个类型参与配色'; }
        AR.Bridge.haptic('light', trackSel);
      });
    }

    // 节次改了 → 时间跟着换（用户再手改时间就会留下"这门课单独的时间"）
    var pStartSel = body.querySelector('#ebPStart');
    var pEndSel = body.querySelector('#ebPEnd');
    function syncTimes() {
      var s = periodDefault(pStartSel.value, 'start');
      var e = periodDefault(pEndSel.value, 'end');
      if (s) { body.querySelector('#ebStart').value = s; }
      if (e) { body.querySelector('#ebEnd').value = e; }
    }
    if (pStartSel) { pStartSel.addEventListener('change', syncTimes); }
    if (pEndSel) { pEndSel.addEventListener('change', syncTimes); }

    function doSave(close) {
      var nameInput = body.querySelector('#ebName');
      var name = (nameInput.value || '').trim();
      if (!name) { toast('课程名不能为空'); nameInput.focus(); return; }
      var tNames = splitTeacherNames(body.querySelector('#ebTeachers').value);
      var placeRaw = (body.querySelector('#ebPlace').value || '').trim();
      var weekday = Number(body.querySelector('#ebWeekday').value) || block.weekday || 1;
      var pStart = Number(pStartSel.value) || startPeriod;
      var pEnd = Number(pEndSel.value) || pStart;
      if (pEnd < pStart) { var tmp = pStart; pStart = pEnd; pEnd = tmp; }
      var startT = (body.querySelector('#ebStart').value || '').trim();
      var endT = (body.querySelector('#ebEnd').value || '').trim();
      var note = body.querySelector('#ebNote').value || '';
      var modeSel = body.querySelector('#ebWeekMode').value || 'all';
      var weeksRaw = (body.querySelector('#ebWeeks').value || '').trim();

      // 1) 课程名 + 颜色：永远作用于整门课（同名合并 / 同色统一由 Store 保证）
      var res = AR.Store.renameCourse(course.id, name);
      if (res && res.ok === false) { toast(res.message || '改名失败'); return; }
      var targetCourse = (res && res.course) || course;
      if (pickedColor && targetCourse.colorKey !== pickedColor) {
        targetCourse.colorKey = pickedColor;
        targetCourse.updatedAt = new Date().toISOString();
      }
      // 课程类型（理科/文科/公共/体育/水课）：空字符串 = 自动识别，不写死
      var trackNow = body.querySelector('#ebTrack');
      if (trackNow) {
        var tv = trackNow.value || '';
        if (tv !== (targetCourse.track || '')) {
          targetCourse.track = tv;
          targetCourse.updatedAt = new Date().toISOString();
        }
      }

      // 2) 老师 / 地点：按名字与原始文本复用已有记录，没有就新建
      var tIds = [];
      for (var i = 0; i < tNames.length; i++) {
        var t = AR.Store.ensureTeacherByName(tNames[i]);
        if (t) { tIds.push(t.id); }
      }
      var loc = placeRaw ? AR.Store.ensureLocationByRaw(placeRaw) : null;

      // 3) 时间：与节次表默认值一致就不写死，以后改节次表能跟着走
      var defStart = periodDefault(pStart, 'start');
      var defEnd = periodDefault(pEnd, 'end');
      var customStart = (startT && startT !== defStart) ? startT : '';
      var customEnd = (endT && endT !== defEnd) ? endT : '';

      // 4) 周次：每周 / 单周 / 双周（可叠范围）/ 自定义列表
      var wk = { weekMode: 'all', weeks: [] };
      if (scope !== 'once') {
        if (modeSel === 'custom') {
          wk = AR.Store.parseWeeksText(weeksRaw, weekCount);
        } else if (modeSel === 'odd' || modeSel === 'even') {
          var parsed = AR.Store.parseWeeksText(weeksRaw, weekCount);
          if (parsed.weekMode === 'custom') {
            var filtered = [];
            for (var q = 0; q < parsed.weeks.length; q++) {
              if ((modeSel === 'odd') === (parsed.weeks[q] % 2 === 1)) { filtered.push(parsed.weeks[q]); }
            }
            wk = { weekMode: 'custom', weeks: filtered };
          } else {
            wk = { weekMode: modeSel, weeks: [] };
          }
        }
      }

      if (scope === 'once') {
        var patch = {
          newPeriodStart: pStart, newPeriodEnd: pEnd,
          newStartTime: customStart, newEndTime: customEnd,
          newLocationIds: loc ? [loc.id] : [], newLocationCleared: !loc,
          newTeacherIds: tIds, newNote: note, newNoteCleared: !note
        };
        var targetKey = U.dateKey(day);
        var moved = weekday !== U.weekdayOf(day);
        if (moved) {
          targetKey = U.dateKey(U.addDays(U.mondayOf(day), weekday - 1));
          patch.type = 'move';
          patch.newDate = targetKey;
          patch.newWeekday = weekday;
        }
        /**
         * 本次修复（v0.3.0 补丁）：只要点开的就是一条已有的单次记录，就按 id 改写它本身。
         *
         * 老逻辑只在「换了星期」或「本来就是调课补进来的」时才走这条路，
         * 其它情况一律 upsertOverride(block.id, …, {type:'edit',…})：
         * 「换教室 / 换时间 / 借课」的记录会被就地降级成一条普通的 edit 记录，
         * 而 edit 以前又没人认领 —— 保存完这节课的改动整条失效（备注改了看不到）。
         * 现在只补字段，type / blockId 原样保留；确实是新记录时才写 type:'edit'。
         */
        var existOv = (item.override && item.override.id) ? AR.Store.overrideById(item.override.id) : null;
        if (existOv) {
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) { existOv[k] = patch[k]; }
          }
          if (moved) { existOv.date = targetKey; }
          existOv.updatedAt = new Date().toISOString();
          AR.Store.save(true);
        } else {
          if (!patch.type) { patch.type = 'edit'; }
          AR.Store.upsertOverride(block.id, course.id, targetKey, patch);
        }
        if (moved) {
          // 原来那天不能再显示这门课
          if (item.kind === 'normal') {
            AR.Store.upsertOverride(block.id, course.id, U.dateKey(day), { type: 'cancel', newDate: null });
          } else if (item.override && item.kind !== 'moved-in') {
            AR.Store.removeOverride(item.override.id);
          }
        }
      } else {
        var up = AR.Store.updateBlock(block.id, {
          weekday: weekday, periodStart: pStart, periodEnd: pEnd,
          startTime: customStart, endTime: customEnd,
          weekMode: wk.weekMode, weeks: wk.weeks,
          locationIds: loc ? [loc.id] : [], teacherIds: tIds, note: note
        });
        if (up && up.ok === false) { toast(up.message || '保存失败'); return; }
      }

      AR.Store.save(true);
      AR.Bridge.haptic('medium', $('modalCard'));
      close();
      renderToday();
      if (currentView === 'week') { renderWeek(); }
      toast('已保存：' + name);
    }

    openModal({
      title: '编辑课程',
      sub: course.name + ' · ' + U.WEEKDAY_NAMES[U.weekdayOf(day)] + ' ' + dayShort
        + ' · ' + U.escapeHtml(item.periodLabel || ''),
      body: body,
      wide: true,
      actions: [
        {
          label: '删除这个时段', kind: 'danger',
          onClick: function (close) {
            if (realBlock) { AR.Store.removeBlock(block.id); }
            else if (item.override) { AR.Store.removeOverride(item.override.id); }
            close();
            AR.Bridge.haptic('warn', $('modalCard'));
            renderToday();
            if (currentView === 'week') { renderWeek(); }
            toast('已删除这个时段');
          }
        },
        { label: '保存', kind: 'primary', onClick: function (close) { doSave(close); } },
        { label: '取消', onClick: function (close) { close(); } }
      ]
    });
    applyScope(scope);
    var focusEl = opts.focus === 'time' ? body.querySelector('#ebStart')
      : (opts.focus === 'period' ? pStartSel : null);
    if (focusEl) { try { focusEl.focus(); } catch (e) { /* 忽略：个别 WebView 不支持聚焦 select */ } }
  }

  /**
   * 课程详情（周表左侧概览 / 今日时间线点开）：
   * v0.2.0 起详细修改统一进「编辑课程」窗口，这里只做速览 + 快捷入口。
   */
  function openCourseModal(item) {
    var sem = AR.Store.currentSemester();
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">时间</div><div class="detail-val">' + U.WEEKDAY_NAMES[U.weekdayOf(item.date)] + ' '
      + U.escapeHtml(fmtRange(item)) + '（' + U.escapeHtml(item.periodLabel) + '）</div>'
      + '<div class="detail-key">周次</div><div class="detail-val">' + U.escapeHtml(AR.Schedule.weeksLabel(item.block, sem.weekCount)) + '</div>'
      + '<div class="detail-key">老师</div><div class="detail-val">' + U.escapeHtml(item.teachers.map(function (t) { return t.name; }).join('、') || '—') + '</div>'
      + '<div class="detail-key">地点</div><div class="detail-val">' + U.escapeHtml(item.location ? item.location.raw : '—') + '</div>'
      + '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(item.note || '—') + '</div>'
      + '</div>'
      + '<div class="muted" style="margin-top:14px">课程名、星期、节次、时间、单双周、老师、地点、颜色，都能在「编辑课程」里改。</div>';
    openModal({
      title: item.course.name,
      sub: '课程详情',
      body: body,
      actions: [
        { label: '编辑课程', kind: 'primary', onClick: function (close) { close(); openBlockEditor(item); } },
        { label: '设置颜色', onClick: function () { openColorModal(item); } },
        { label: '编辑备注', onClick: function () { openNoteModal(item); } },
        { label: '删除这门课', kind: 'danger', onClick: function (close) { deleteCourse(item.course.id, close); } },
        { label: '关闭', onClick: function (close) { close(); } }
      ]
    });
  }

  function openColorModal(item) {
    var box = el('<div class="swatches"></div>');
    var picked = item.course.colorKey;
    for (var i = 0; i < U.PALETTE.length; i++) {
      (function (p) {
        var sw = el('<div class="swatch' + (item.course.colorKey === p.key ? ' active' : '')
          + '" title="' + p.name + '" style="background:' + p.hex + '"></div>');
        sw.addEventListener('click', function () {
          item.course.colorKey = p.key;
          item.course.updatedAt = new Date().toISOString();
          AR.Store.save(true);
          AR.Bridge.haptic('light', sw);
          closeModal();
          renderToday();
          renderWeek();
          toast('颜色已改为' + p.name);
        });
        box.appendChild(sw);
      })(U.PALETTE[i]);
    }
    // 色盘：想要什么颜色自己挑（存 #RRGGBB，双端一致）
    var custom = /^#[0-9a-fA-F]{6}$/.test(String(picked)) ? picked : '#5B8DEF';
    var wrap = el('<div></div>');
    wrap.appendChild(box);
    var row = el('<div class="row color-custom" style="margin-top:12px">'
      + '<button class="btn color-open" type="button" id="courseColorPick">'
      + '<span class="co-dot" id="courseColorDot" style="background:' + custom + '"></span>打开色盘</button>'
      + '<button class="btn primary" type="button" id="courseColorApply">用这个颜色</button></div>');
    wrap.appendChild(row);
    openModal({
      title: '课程颜色', sub: item.course.name, body: wrap,
      actions: [{ label: '取消', onClick: function (c) { c(); } }]
    });
    var applyBtn = $('courseColorApply');
    var pickBtn = $('courseColorPick');
    if (pickBtn) {
      pickBtn.addEventListener('click', function () {
        openColorPicker(custom, function (hex) {
          custom = hex;
          var dot = $('courseColorDot');
          if (dot) { dot.style.background = hex; }
          AR.Bridge.haptic('light', pickBtn);
        }, { title: '课程颜色 · ' + item.course.name });
      });
    }
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        var hex = custom;
        item.course.colorKey = hex;
        item.course.updatedAt = new Date().toISOString();
        AR.Store.save(true);
        AR.Bridge.haptic('medium', applyBtn);
        closeModal();
        renderToday();
        renderWeek();
        toast('颜色已改为 ' + hex);
      });
    }
  }

  function deleteCourse(courseId, close) {
    var blocks = AR.Store.blocksOfCourse(courseId);
    for (var i = 0; i < blocks.length; i++) { AR.Store.markDeleted('blocks', blocks[i].id); }
    var list = S.blocks;
    S.blocks = list.filter(function (b) { return b.courseId !== courseId; });
    S.courses = S.courses.filter(function (c) { return c.id !== courseId; });
    AR.Store.save(true);
    close();
    AR.Bridge.haptic('warn', $('zoneNext'));
    renderToday();
    renderWeek();
    toast('已删除该课程');
  }

  /* 位置模块 */
  function openLocationModal(item) {
    var raw = item.location ? item.location.raw : '';
    var nav = AR.Location.navQuery(raw, S.settings);
    var body = el('<div></div>');
    body.appendChild(el('<div class="detail-grid">'
      + '<div class="detail-key">原始地点</div><div class="detail-val">' + U.escapeHtml(raw || '未填写') + '</div>'
      + '<div class="detail-key">裁剪后</div><div class="detail-val">' + U.escapeHtml(nav.trimmed || '—') + '</div>'
      + '<div class="detail-key">解析</div><div class="detail-val">'
      + (nav.steps.length ? nav.steps.map(function (s) { return U.escapeHtml(s); }).join(' · ') : '未做调整') + '</div>'
      + '</div>'));
    var field = el('<div class="field" style="margin-top:14px"><label class="field-label">最终导航查询词（可修改）</label>'
      + '<input class="input" id="navQueryInput" value="' + U.escapeHtml(nav.query) + '"></div>');
    body.appendChild(field);
    if (nav.online) {
      body.appendChild(el('<div class="issue info"><span class="msg">识别为线上课程，按规则不打开地图，可复制会议信息。</span></div>'));
    }
    body.appendChild(el('<div class="muted" style="margin-top:8px">导航偏好：'
      + navAppName(S.settings.integration.navApp) + '（可在 设置 → 系统集成 修改）</div>'));

    openModal({
      title: '位置',
      sub: item.course.name,
      body: body,
      actions: [
        { label: '复制地址', onClick: function () { AR.Bridge.copy(raw || nav.query); } },
        {
          label: '打开导航', kind: 'primary', onClick: function () {
            var q = ($('navQueryInput') && $('navQueryInput').value || '').trim() || nav.query;
            if (!q) { toast('请先填写地点'); return; }
            if (nav.online && S.settings.integration.onlineTreatAsNoNav) { toast('线上课程不导航，已复制'); AR.Bridge.copy(raw); return; }
            AR.Bridge.openMap(S.settings.integration.navApp, q, AR.Location.navWebUrl(q, S.settings.integration.navApp));
          }
        },
        {
          label: '编辑地点', onClick: function () {
            openEditPlaceModal(item);
          }
        }
      ]
    });
  }

  function navAppName(key) {
    return key === 'amap' ? '高德地图' : (key === 'baidu' ? '百度地图' : (key === 'google' ? 'Google 地图' : '系统地图'));
  }

  function openEditPlaceModal(item) {
    var body = el('<div class="field"><label class="field-label">地点（原样保存，导航时自动裁剪）</label>'
      + '<input class="input" id="placeEditInput" value="'
      + U.escapeHtml(item.location ? item.location.raw : '') + '"></div>');
    openModal({
      title: '编辑地点', sub: item.course.name, body: body,
      actions: [{
        label: '保存', kind: 'primary', onClick: function (close) {
          var v = ($('placeEditInput') && $('placeEditInput').value || '').trim();
          if (item.location) {
            item.location.raw = v;
            item.location.updatedAt = new Date().toISOString();
          } else {
            var parts = AR.MdParse.parsePlaceParts(v, S.settings.integration);
            var loc = {
              id: U.uid(), raw: v, building: parts.building, campus: parts.campus,
              university: parts.university, city: parts.city, room: parts.room,
              navQueryOverride: '', updatedAt: new Date().toISOString()
            };
            S.locations.push(loc);
            // 这节课原本没有地点：写入真正生效的那一层（单次记录或时段本身）
            if (!writeItemField(item, 'location', [loc.id])) { toast('没找到这节课的记录，保存失败'); return; }
            item.location = loc;
          }
          AR.Store.save(true);
          close();
          AR.Bridge.haptic('medium', $('zoneNext'));
          refreshAfterItemEdit();
          toast('地点已保存');
        }
      }]
    });
  }

  /** 时间模块：系统日历 / 闹钟 */
  function openTimeModal(item, day) {
    var startMs = toMs(day, item.start);
    var endMs = toMs(day, item.end) || (startMs + 45 * 60000);
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">日期</div><div class="detail-val">' + (day.getFullYear()) + ' 年 '
      + (day.getMonth() + 1) + ' 月 ' + day.getDate() + ' 日 ' + U.WEEKDAY_NAMES[U.weekdayOf(day)] + '</div>'
      + '<div class="detail-key">节次</div><div class="detail-val">' + U.escapeHtml(item.periodLabel) + '</div>'
      + '<div class="detail-key">时间</div><div class="detail-val">' + U.escapeHtml(fmtRange(item)) + '</div>'
      + '<div class="detail-key">时长</div><div class="detail-val">'
      + (item.startMin != null && item.endMin != null ? (item.endMin - item.startMin) + ' 分钟' : '—') + '</div>'
      + '</div>'
      + '<p class="panel-sub" style="margin-top:12px">课前进度提醒：'
      + (S.settings.notifications.enabled ? ('提前 ' + S.settings.notifications.defaultOffset + ' 分钟通知') : '未开启（可在设置里打开）')
      + '</p>';
    openModal({
      title: '时间', sub: item.course.name, body: body,
      actions: [
        {
          // v0.2.0：时间 / 节次本身也能改（写回这门课的排课）
          label: '编辑时间 / 节次', onClick: function (close) { close(); openBlockEditor(item, { focus: 'time' }); }
        },
        {
          label: '添加到系统日历', kind: 'primary', onClick: function () {
            AR.Bridge.addCalendarEvent(
              item.course.name,
              item.location ? item.location.raw : '',
              'Abbey Road 课表 · ' + item.periodLabel + (item.note ? ' · ' + item.note : ''),
              startMs, endMs);
            AR.Bridge.haptic('medium', $('modalCard'));
          }
        },
        {
          label: '设置闹钟', onClick: function () {
            var hm = (item.start || '08:00').split(':');
            AR.Bridge.setAlarm(Number(hm[0]), Number(hm[1]), item.course.name + ' ' + (item.location ? item.location.raw : ''));
            AR.Bridge.haptic('medium', $('modalCard'));
          }
        },
        {
          label: '修改提醒', onClick: function () {
            S.settings.notifications.enabled = true;
            S.settings.notifications.defaultOffset = S.settings.notifications.defaultOffset || 15;
            AR.Store.save(true);
            AR.Panels.renderSettings();
            toast('已开启课前提醒：提前 ' + S.settings.notifications.defaultOffset + ' 分钟（可在设置里调整）');
          }
        }
      ]
    });
  }

  function toMs(day, hm) {
    if (!hm) { return null; }
    var parts = hm.split(':');
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(parts[0]), Number(parts[1]), 0, 0).getTime();
  }

  /**
   * 老师模块（v0.2.0：姓名也能改，还能加 / 删老师）
   * 保存后把顺序按行写回这个时段的 teacherIds。
   */
  function openTeacherModal(item) {
    /**
     * 本次修复（v0.3.0 补丁）：以前这里把 body 直接写成 <div id="teacherList">，
     * 紧接着又用 body.querySelector('#teacherList') 去找它自己 —— querySelector
     * 只找后代，永远返回 null。结果是：
     *   · 这门课已经有老师时，下面的 list.appendChild 直接抛 TypeError，
     *     整个「老师」窗口打不开（连带里面的老师备注也编辑不了）；
     *   · 没有老师时，「+ 添加老师」按钮点了没反应。
     * 现在老老实实建一层外壳 + 一个列表容器，两个问题一起解决。
     */
    var body = el('<div></div>');
    var list = el('<div id="teacherList"></div>');

    function teacherRow(t) {
      var exists = !!t;
      var row = el('<div class="field teacher-row" data-teacher="' + (exists ? t.id : '') + '">'
        + '<div class="row" style="gap:8px;align-items:flex-end">'
        + '<div style="flex:1 1 130px"><label class="field-label">姓名</label>'
        + '<input class="input" data-field="name" placeholder="老师姓名" value="'
        + U.escapeHtml(exists ? t.name : '') + '"></div>'
        + '<button class="icon-btn" type="button" data-remove title="移除">✕</button></div>'
        + '<input class="input" style="margin-top:8px" data-field="note" placeholder="备注（如：办公室 / 答疑时间）" value="'
        + U.escapeHtml(exists ? (t.note || '') : '') + '">'
        + '<input class="input" style="margin-top:8px" data-field="contact" placeholder="联系方式（电话 / 邮箱 / 微信）" value="'
        + U.escapeHtml(exists ? (t.contact || '') : '') + '"></div>');
      row.querySelector('[data-remove]').addEventListener('click', function () {
        AR.Bridge.haptic('light', row);
        row.parentNode.removeChild(row);
      });
      return row;
    }

    if (!item.teachers.length) {
      body.appendChild(el('<p class="muted">还没有老师信息，点下面的「+ 添加老师」填一个就行。</p>'));
    }
    body.appendChild(list);
    for (var i = 0; i < item.teachers.length; i++) { list.appendChild(teacherRow(item.teachers[i])); }

    var addRow = el('<button class="chip-btn" type="button" id="teacherAdd">+ 添加老师</button>');
    addRow.addEventListener('click', function () {
      list.appendChild(teacherRow(null));
      AR.Bridge.haptic('light', addRow);
    });
    body.appendChild(addRow);

    openModal({
      title: '老师', sub: item.course.name, body: body,
      actions: [
        {
          label: '复制姓名', onClick: function () {
            AR.Bridge.copy(item.teachers.map(function (x) { return x.name; }).join('、') || '');
          }
        },
        {
          label: '保存', kind: 'primary', onClick: function (close) {
            var rows = body.querySelectorAll('.teacher-row');
            var ids = [];
            for (var i = 0; i < rows.length; i++) {
              var row = rows[i];
              var name = (row.querySelector('[data-field="name"]').value || '').trim();
              if (!name) { continue; }
              var note = row.querySelector('[data-field="note"]').value || '';
              var contact = row.querySelector('[data-field="contact"]').value || '';
              var id = row.getAttribute('data-teacher');
              var t = id ? AR.Store.teacherById(id) : AR.Store.ensureTeacherByName(name);
              if (!t) { continue; }
              t.name = name;
              t.note = note;
              t.contact = contact;
              t.updatedAt = new Date().toISOString();
              if (ids.indexOf(t.id) < 0) { ids.push(t.id); }
            }
            if (!writeItemField(item, 'teacher', ids)) { toast('没找到这节课的记录，保存失败'); return; }
            item.teachers = [];
            for (var q = 0; q < ids.length; q++) {
              var tt = AR.Store.teacherById(ids[q]);
              if (tt) { item.teachers.push(tt); }
            }
            close();
            AR.Bridge.haptic('medium', $('zoneNext'));
            refreshAfterItemEdit();
            toast('已保存老师信息');
          }
        }
      ]
    });
  }

  /**
   * 把「这一格」的改动写回**真正生效的那条记录**。
   *
   * 老实现统一写 item.block.note / item.block.teacherIds，两种情况会白改：
   *   ① 补课 / 加课：渲染时 item.block 是临时拼出来的对象，根本不在仓库里，
   *      写进去当场就丢（备注保存后依旧显示旧值就是这么来的）；
   *   ② 那天的课本来就有一条单次记录（调课 / 换教室 / 换时间）：真正生效的
   *      是记录里的值，写 block 等于写了另一层，界面上看不到任何变化。
   * decorate() 现在会顺带给出 src（每个字段来自 override / block / course），
   * 这里据此决定写哪一层：
   *   - src = override，或这节课没有真实模板（补课 / 加课）→ 写单次记录，只影响这一天；
   *   - 其它情况 → 写时段（block），这门课没被单独调整过的周都会跟着变。
   * 返回被写入的对象；写不进去返回 null。
   */
  function editTargetOf(item, field) {
    var ov = (item.override && item.override.id) ? AR.Store.overrideById(item.override.id) : null;
    var real = (item.block && item.block.id && AR.Store.blockById) ? AR.Store.blockById(item.block.id) : null;
    var source = (item.src && item.src[field]) || 'block';
    // 补课 / 加课：这节课的数据本来就只存在单次记录里，改哪一格都写记录
    var oneOff = (item.kind === 'makeup' || item.kind === 'add');
    var target;
    if (source === 'override' || oneOff || !real) { target = ov || real; }
    else { target = real; }
    return { ov: ov, real: real, target: target, once: !!target && target === ov };
  }

  /** 这个字段这次会改到「只这一天」还是「这门课所有时段」——弹窗里给用户一句提示 */
  function editScopeOf(item, field) {
    return editTargetOf(item, field).once ? 'once' : 'all';
  }

  function writeItemField(item, field, value) {
    var pick = editTargetOf(item, field);
    var ov = pick.ov;
    var target = pick.target;
    if (!target) { return null; }

    if (field === 'note') {
      if (target === ov) { ov.newNote = value; ov.newNoteCleared = !value; }
      else { target.note = value; }
    } else if (field === 'teacher') {
      if (target === ov) { ov.newTeacherIds = value; }
      else { target.teacherIds = value; }
    } else if (field === 'location') {
      if (target === ov) { ov.newLocationIds = value; ov.newLocationCleared = !(value && value.length); }
      else { target.locationIds = value; }
    } else {
      target[field] = value;
    }
    target.updatedAt = new Date().toISOString();
    /**
     * 临时 block（补课 / 加课那种渲染时拼出来的对象）顺手同步一份，
     * 重画之前卡片上就能显示新值。真正的模板 block 不能在这里改 ——
     * 上面把改动写进单次记录时，再动模板就等于把「只改这一次」变成了改整门课。
     */
    if (item.block && !pick.real) {
      if (field === 'note') { item.block.note = value; }
      else if (field === 'teacher') { item.block.teacherIds = value; }
      else if (field === 'location') { item.block.locationIds = value; }
    }
    AR.Store.save(true);
    return target;
  }

  /* 备注模块 */
  function openNoteModal(item) {
    var body = el('<div class="field"><label class="field-label">备注（会显示在课程详情里）</label>'
      + '<textarea class="input" id="noteEditInput" rows="6">' + U.escapeHtml(item.note || '') + '</textarea></div>');
    openModal({
      title: '备注',
      sub: item.course.name + (editScopeOf(item, 'note') === 'once'
        ? ' · 只改 ' + (item.date.getMonth() + 1) + '/' + item.date.getDate() + ' 这一次'
        : ' · 这门课的所有时段'),
      body: body,
      actions: [
        { label: '复制', onClick: function () { AR.Bridge.copy(item.note || ''); } },
        {
          label: '保存', kind: 'primary', onClick: function (close) {
            var v = ($('noteEditInput') && $('noteEditInput').value || '');
            if (!writeItemField(item, 'note', v)) { toast('没找到这节课的记录，保存失败'); return; }
            item.note = v;
            close();
            AR.Bridge.haptic('medium', $('zoneNext'));
            refreshAfterItemEdit();
            toast(v ? '备注已保存' : '备注已清空');
          }
        }
      ]
    });
  }

  /** 改完某一节课的字段后统一刷新（今日 / 周表 / 最近的课都跟着变） */
  function refreshAfterItemEdit() {
    renderToday();
    if (currentView === 'week') { renderWeek(); }
  }

  /* ── Toast ────────────────────────────────────────────────── */

  function toast(msg) {
    var host = $('toastHost');
    var node = el('<div class="toast">' + U.escapeHtml(msg) + '</div>');
    host.appendChild(node);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) { node.parentNode.removeChild(node); } }, 220);
    }, 1800);
  }

  /* ── 拆分隔条 ─────────────────────────────────────────────── */

  /** 三个区域：收起状态点哪都能展开；展开状态把点击让给里面的卡片/按钮 */
  function bindZone(id, zone) {
    var node = $(id);
    if (!node) { return; }
    node.addEventListener('click', function (ev) {
      if (Layout.expanded === zone) { return; }
      setExpanded(zone);
    });
    node.addEventListener('keydown', function (ev) {
      if (ev.target !== node) { return; }
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setExpanded(zone);
      }
    });
  }

  /**
   * 收起状态下点到栏内的卡片 / 模块时：先把这一栏展开，而不是"点了没反应"。
   * 返回 true 表示这次点击已经被当成"展开"处理掉了。
   */
  function expandOwningZone(node) {
    var z = node && node.closest ? node.closest('.zone') : null;
    if (!z || z.classList.contains('expanded')) { return false; }
    var map = { zoneWeek: 'week', zoneToday: 'today', zoneNext: 'next' };
    var key = map[z.id];
    if (!key) { return false; }
    setExpanded(key);
    return true;
  }

  /** 正在编辑输入框？（键盘弹出会触发 resize，此时绝不能重建页面） */
  function isEditingField() {
    var a = document.activeElement;
    if (!a) { return false; }
    var tag = String(a.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!a.isContentEditable;
  }

  /**
   * 重新播一遍某一栏的内容浮入动画。
   * 规格书规则 2：取消 → 复位 → 强制刷新 → 启动，所以连续点日期也能每次都看到动画。
   */
  function replayZoneContent(id) {
    var z = $(id);
    if (!z) { return; }
    z.classList.remove('z-in');
    void z.offsetWidth;
    z.classList.add('z-in');
    setTimeout(function () { z.classList.remove('z-in'); }, 560);
  }

  /**
   * 「本周概览」里切换日期时的过渡。
   *
   * 之前只是整块重画 + 一次通用淡入，看着像"闪一下"，也没有方向感。
   * 现在：
   *   ① 内容按方向滑入（往后一天从右侧进、往前一天从左侧进）并带一点点缩放；
   *   ② 被选中的那一天做一次明显的"落定"动画（放大回弹 + 主题色描边）；
   *   ③ 曲线取自 motion 注册表，和全局动效风格保持一致。
   */
  function playDaySwitch(dir) {
    var zone = $('zoneWeek');
    if (!zone) { return; }
    var body = zone.querySelector('.zone-body');
    var speed = motionSpeed();
    var d = dir || 0;
    var shift = d === 0 ? 0 : (d > 0 ? 26 : -26);
    if (body && body.animate) {
      if (body.__dayAnim) { try { body.__dayAnim.cancel(); } catch (e) { } }
      body.__dayAnim = body.animate(
        [
          { opacity: .25, transform: 'translate3d(' + shift + 'px,0,0) scale(.985)' },
          { opacity: 1, transform: 'translate3d(0px,0px,0) scale(1)' }
        ],
        {
          duration: Math.round(360 / speed),
          easing: AR.Motion ? AR.Motion.ease('spring') : 'cubic-bezier(.34,1.42,.52,1)',
          fill: 'none'
        }
      );
    }
    var sel = body ? body.querySelector('.mg-day.today, .wt-day.today') : null;
    // 「本周概览」的日期选择也做成滑块：把指示块滑到选中的那一天
    var table = body ? body.querySelector('.mini-table, .week-table') : null;
    if (table && sel) {
      var pill = table.querySelector('.day-pill');
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'day-pill';
        table.appendChild(pill);
      }
      var tx = sel.offsetLeft, tw = sel.offsetWidth, th = sel.offsetHeight, ty = sel.offsetTop;
      if (pill.__x == null) {
        pill.style.width = tw + 'px'; pill.style.height = th + 'px';
        pill.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
      } else if (pill.animate) {
        pill.animate(
          [{ transform: 'translate(' + pill.__x + 'px,' + pill.__y + 'px)', width: pill.__w + 'px' },
           { transform: 'translate(' + tx + 'px,' + ty + 'px)', width: tw + 'px' }],
          { duration: Math.round(360 / motionSpeed()), easing: AR.Motion ? AR.Motion.ease('spring') : 'cubic-bezier(.34,1.42,.52,1)', fill: 'none' }
        );
        pill.style.width = tw + 'px'; pill.style.height = th + 'px';
        pill.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
      }
      pill.__x = tx; pill.__y = ty; pill.__w = tw;
    }
    if (sel && sel.animate) {
      if (sel.__selAnim) { try { sel.__selAnim.cancel(); } catch (e) { } }
      sel.classList.add('day-picked');
      sel.__selAnim = sel.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.18)', offset: .38 },
          { transform: 'scale(1)' }
        ],
        {
          duration: Math.round(460 / speed),
          easing: AR.Motion ? AR.Motion.ease('back') : 'cubic-bezier(.28,1.3,.46,1)',
          fill: 'none'
        }
      );
      setTimeout(function () { sel.classList.remove('day-picked'); }, Math.round(540 / speed));
    }
  }

  /**
   * 规格书 4.7：按钮点击 = 整颗均匀高光（不是涟漪、不是外发光）。
   * 颜色 92% 白 + 8% 主题色；峰值不透明度 0.30；500ms 衰减；
   * 重启动画遵守"取消 → 复位 → 强制刷新 → 启动"。
   */
  function flashButton(el) {
    if (!el || !el.appendChild) { return; }
    var f = el.__flash;
    if (!f || !f.isConnected) {
      f = document.createElement('span');
      f.className = 'flash';
      el.appendChild(f);
      el.__flash = f;
    }
    if (f.getAnimations) {
      var olds = f.getAnimations();
      for (var i = 0; i < olds.length; i++) { olds[i].cancel(); }
    }
    f.style.opacity = '0';                 // 复位
    void f.offsetWidth;                    // 强制刷新
    var accent = (AR.Store.get().settings.appearance.accent) || '#5B8DEF';
    f.style.background = mixWithWhite(accent, 0.08);
    if (f.animate) {
      f.animate(
        [{ opacity: 0 }, { opacity: 0.30, offset: 0.12 }, { opacity: 0 }],
        { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' }
      );
    } else {
      f.style.opacity = '0.30';
      setTimeout(function () { f.style.opacity = '0'; }, 120);
    }
  }

  /** 92% 白 + 8% 目标色的实心高光（Chromium 101 不支持 color-mix，这里手算） */
  function mixWithWhite(hex, t) {
    var h = String(hex || '#5B8DEF').replace('#', '');
    if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
    var r = parseInt(h.substring(0, 2), 16) || 0;
    var g = parseInt(h.substring(2, 4), 16) || 0;
    var b = parseInt(h.substring(4, 6), 16) || 0;
    var m = function (c) { return Math.round(255 * (1 - t) + c * t); };
    return 'rgba(' + m(r) + ',' + m(g) + ',' + m(b) + ',1)';
  }

  function bindFlash() {
    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) { return; }
      // 滑块（.seg）按规格书明确不做点击高光
      var el = t.closest('.btn, .chip-btn, .module, .preset-card, .icon-btn, .week-chip, .zone-toggle');
      if (el) { flashButton(el); }
    }, true);
  }

  /**
   * 规格书 4.1：区块入场 rise（60ms 错峰；头部 -24px 自上下落，其余 +12px 自下浮起；
   * 500ms CUBIC；只动 opacity / translate / scale）。
   */
  function enterRise(viewEl) {
    if (!viewEl || !viewEl.querySelectorAll) { return; }
    var m = AR.Motion ? AR.Motion.get('viewIn') : null;
    if (m && !m.dur) { return; }                       // 「无动画」
    var speed = motionSpeed();
    var nodes = viewEl.querySelectorAll('.view-head, .zone, .glass.panel, .week-strip, .settings-nav, .set-section');
    var delay = (m && m.stagger === 0) ? 0 : 50;
    var stagger = m ? (m.stagger || 0) : 60;
    var dur = m ? Math.round(m.dur / speed) : 500;
    var ease = AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.2,.8,.3,1)';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.animate) { continue; }
      var y = (i === 0) ? ((m && m.headY != null) ? m.headY : -24) : ((m && m.y != null) ? m.y : 12);
      var x = (m && m.x) ? m.x : 0;
      var s = (m && m.s != null) ? m.s : .97;
      var tf = [];
      if (x || y) { tf.push('translate3d(' + x + 'px,' + y + 'px,0)'); }
      if (s !== 1) { tf.push('scale(' + s + ')'); }
      if (!tf.length) { tf.push('none'); }
      if (n.__rise) { n.__rise.cancel(); }
      n.__rise = n.animate(
        [
          { opacity: 0, transform: tf.join(' ') },
          { opacity: 1, transform: 'none' }
        ],
        { duration: dur, delay: Math.round(delay / speed), easing: ease, fill: 'backwards' }
      );
      delay += stagger;
    }
  }

  /** 规格书 4.2：列表子项只做透明度淡入，30ms 错峰、180ms、FADE_OUT */
  function fadeInList(container, selector) {
    if (!container || !container.querySelectorAll) { return; }
    var m = AR.Motion ? AR.Motion.get('listIn') : null;
    if (m && !m.dur) { return; }
    var speed = motionSpeed();
    var nodes = container.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.animate) { continue; }
      if (n.__fade) { n.__fade.cancel(); }
      var x = (m && m.x) ? m.x : 0, y = (m && m.y) ? m.y : 0;
      var s = (m && m.s != null) ? m.s : 1;
      var tf = [];
      if (x || y) { tf.push('translate3d(' + x + 'px,' + y + 'px,0)'); }
      if (s !== 1) { tf.push('scale(' + s + ')'); }
      if (!tf.length) { tf.push('none'); }
      n.__fade = n.animate(
        [{ opacity: 0, transform: tf.join(' ') }, { opacity: 1, transform: 'none' }],
        {
          duration: m ? Math.round(m.dur / speed) : 180,
          delay: Math.round((i * (m ? (m.stagger || 30) : 30)) / speed),
          easing: AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.22,1,.36,1)',
          fill: 'backwards'
        }
      );
    }
  }

  /** 规格书 4.9/4.10：分段控件的胶囊滑动（420ms SMOOTH），禁止高光 */
  function enhanceSegmented(root) {
    var segs = (root || document).querySelectorAll('.segmented');
    for (var i = 0; i < segs.length; i++) { syncSegPill(segs[i], false); }
  }

  function syncSegPill(seg, animate) {
    if (!seg) { return; }
    var active = seg.querySelector('.seg.active') || seg.querySelector('.seg');
    if (!active) { return; }
    var pill = seg.querySelector('.seg-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'seg-pill';
      seg.insertBefore(pill, seg.firstChild);
    }
    var nx = active.offsetLeft, nw = active.offsetWidth, nh = active.offsetHeight, ny = active.offsetTop;
    if (!nw) { return; }
    var prevX = pill.__x, prevW = pill.__w;
    pill.style.height = nh + 'px';
    pill.style.width = nw + 'px';
    pill.style.top = ny + 'px';
    pill.style.transformOrigin = '0 0';
    pill.style.transform = 'translateX(' + nx + 'px)';
    pill.__x = nx; pill.__w = nw;
    if (!animate || prevX == null || !prevW) { return; }
    var sx = prevW / nw, tx = prevX - nx;
    if (pill.__anim) { pill.__anim.cancel(); }
    pill.style.transform = 'translateX(' + tx + 'px) scaleX(' + sx + ')';   // 复位到旧几何
    void pill.offsetWidth;                                                 // 强制刷新
    pill.__anim = pill.animate(
      [
        { transform: 'translateX(' + tx + 'px) scaleX(' + sx + ')' },
        { transform: 'translateX(' + nx + 'px) scaleX(1)' }
      ],
      { duration: 420, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'none' }
    );
    pill.style.transform = 'translateX(' + nx + 'px) scaleX(1)';
  }


  /* ── 初始化 ───────────────────────────────────────────────── */

  function init() {
    U = AR.Util;
    S = AR.Store.load();
    Layout.el = $('todayLayout');
    Layout.profiles = loadProfiles();

    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        show(ev.currentTarget.getAttribute('data-nav'));
      });
    }
    $('btnPrevDay').addEventListener('click', function () { cursorDate = U.addDays(cursorDate, -1); AR.Bridge.haptic('light', $('zoneNext')); renderToday(); });
    $('btnNextDay').addEventListener('click', function () { cursorDate = U.addDays(cursorDate, 1); AR.Bridge.haptic('light', $('zoneNext')); renderToday(); });
    $('btnToday').addEventListener('click', function () { cursorDate = new Date(); renderToday(); });
    // 周表右上角：切换学期
    if ($('weekSemBtn')) {
      $('weekSemBtn').addEventListener('click', function () { openSemesterPicker(); });
    }
    $('btnPrevWeek').addEventListener('click', function () {
      var before = weekCursor || 1;
      weekCursor = Math.max(1, before - 1);
      AR.Bridge.haptic('light', $('btnPrevWeek'));
      renderWeek({ swap: weekCursor === before ? 0 : -1 });
    });
    $('btnNextWeek').addEventListener('click', function () {
      var before = weekCursor || 1;
      var max = AR.Store.currentSemester().weekCount;
      weekCursor = Math.min(max, before + 1);
      AR.Bridge.haptic('light', $('btnNextWeek'));
      renderWeek({ swap: weekCursor === before ? 0 : 1 });
    });
    $('btnThisWeek').addEventListener('click', function () {
      var target = Math.max(1, AR.Schedule.weekNumber(new Date()));
      var dir = target === (weekCursor || 1) ? 0 : (target > (weekCursor || 1) ? 1 : -1);
      weekCursor = target;
      AR.Bridge.haptic('medium', $('btnThisWeek'));
      renderWeek({ swap: dir });
    });

    // 三个区域都能点开（右下角 ⤢ 按钮同理）；展开后 ✕ 或 Esc 收起
    bindZone('zoneWeek', 'week');
    bindZone('zoneToday', 'today');
    bindZone('zoneNext', 'next');
    var toggles = document.querySelectorAll('[data-zone-toggle]');
    for (var tg = 0; tg < toggles.length; tg++) {
      (function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          setExpanded(btn.getAttribute('data-zone-toggle'));
        });
      })(toggles[tg]);
    }
    $('modalScrim').addEventListener('click', closeModal);

    // 冲突检测：右上角按钮 → 弹窗看清单（不再占一整块面板）
    var ctBtn = $('btnConflicts');
    if (ctBtn) {
      ctBtn.addEventListener('click', function () {
        AR.Bridge.haptic('light', ctBtn);
        openConflicts();
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (!closeModal()) { if (Layout.expanded) { setExpanded(null); } }
      }
    });
    // 调休 / 借课：默认来源用"当前正在看的那一天"
    var dsBtn = $('btnDayShift');
    if (dsBtn) {
      dsBtn.addEventListener('click', function () {
        AR.Bridge.haptic('light', dsBtn);
        var sem = AR.Store.currentSemester();
        var monday = sem ? U.mondayOf(U.parseDateKey(sem.startDate)) : U.mondayOf(new Date());
        openDayShift(U.addDays(monday, (weekCursor - 1) * 7));
      });
    }
    bindFlash();

    var resize = U.debounce(function () {
      var key = breakpointKey(document.documentElement.clientWidth);
      var changed = key !== Layout.profileKey;
      Layout.profileKey = key;
      applyLayout(false);
      if (changed && currentView === 'week') { renderWeek(); }
      /**
       * 设置页只在「断点真的变了」且「没有正在输入」时才重建。
       * 否则软键盘弹出/收起会触发 resize → 整页重建 → 输入框被换掉，用户就打不进字。
       */
      if (changed && currentView === 'settings' && !isEditingField() && AR.Panels) {
        AR.Panels.renderSettings();
      }
    }, 120);
    window.addEventListener('resize', resize);
    AR.onResize = resize;

    // 顶栏时钟：精确到秒，每秒刷新（页面在后台时跳过，回来立刻补上）
    updateClock();
    setInterval(function () {
      if (document.hidden) { return; }
      updateClock();
    }, 1000);
    startNextTicker();     // 「最近的课」倒计时：10 秒一刷，回前台立即补

    // 系统主题
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) { mq.addEventListener('change', function () { applyTheme(); }); }
    AR.onSystemTheme = applyTheme;

    applyTheme();
    applyMotion();
    applyGlass();
    Layout.profileKey = breakpointKey(document.documentElement.clientWidth);
    lastTodayKey = U.dateKey(new Date());
    show('today');
    applyLayout(false);
    setTimeout(function () { applyLayout(false); }, 60);

    // 回到前台 / 系统换天：如果用户本来就在看「今天」，自动跟到新的今天
    AR.onResume = onResume;
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { onResume(); } });
    window.addEventListener('focus', onResume);
  }

  function onResume() {
    var now = new Date();
    var key = U.dateKey(now);
    var prevToday = lastTodayKey ? U.parseDateKey(lastTodayKey) : null;
    var wasOnToday = !prevToday || U.sameDay(cursorDate, prevToday);
    if (key !== lastTodayKey) {
      if (wasOnToday) { cursorDate = now; }
      var sem = AR.Store.currentSemester();
      if (sem && currentView === 'week') {
        weekCursor = Math.max(1, AR.Schedule.weekNumber(now, sem));
        renderWeek();
      } else if (currentView === 'today') {
        renderToday();
      }
      lastTodayKey = key;
    }
    updateClock();
    if (AR.WidgetData && AR.WidgetData.sync) { AR.WidgetData.sync(true); }
  }

  /* ── 主题 / 动效 / 毛玻璃 ─────────────────────────────────── */

  function effectiveDark() {
    var mode = S.settings.appearance.theme;
    if (mode === 'dark') { return true; }
    if (mode === 'light') { return false; }
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme() {
    var dark = effectiveDark();
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    var accent = S.settings.appearance.accent || '#5B8DEF';
    // 主题色写在 <body> 上（而不是 :root）：
    // tokens.css 里 body[data-theme="dark"] 也定义了 --accent，写在 :root 上会被它盖住，
    // 这就是之前"暗色模式下换主题色没反应"的原因。写在 body 的行内样式优先级更高，浅色/深色都生效。
    var bs = document.body.style;
    bs.setProperty('--accent', accent);
    bs.setProperty('--accent-soft', hexA(accent, 0.14));
    bs.setProperty('--accent-glow', hexA(accent, 0.22));
    bs.setProperty('--accent-contrast', '#ffffff');
    // 背景柔光斑跟着主题色走，毛玻璃后面才有对应的色相（暗色下更亮一点）
    bs.setProperty('--blob-a', hexA(accent, dark ? 0.30 : 0.26));
    bs.setProperty('--blob-b', hexA(accent, dark ? 0.20 : 0.16));
    AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark);
  }

  function hexA(hex, a) {
    var h = String(hex || '#5B8DEF').replace('#', '');
    if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
    var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ── 取色器（参考绘图软件：饱和/明度方块 + 色相条 + 十六进制 + 最近使用） ──
     原生 <input type="color"> 在手机上要么难用、要么各家界面都不一样，
     这里自己画一个：手指在方块里拖、在色相条上滑，下面还能直接填 #RRGGBB。 */

  var RECENT_KEY = 'abbeyroad.recentColors';

  function recentColors() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return (arr && arr.length) ? arr : [];
    } catch (e) { return []; }
  }

  function pushRecentColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { return; }
    var list = recentColors().filter(function (h) { return String(h).toLowerCase() !== hex.toLowerCase(); });
    list.unshift(hex);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { }
  }

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    return {
      r: parseInt(h.substring(0, 2), 16) || 0,
      g: parseInt(h.substring(2, 4), 16) || 0,
      b: parseInt(h.substring(4, 6), 16) || 0
    };
  }

  function rgbToHex(r, g, b) {
    var f = function (v) {
      var n = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return n.length === 1 ? '0' + n : n;
    };
    return '#' + f(r) + f(g) + f(b);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d) {
      if (max === r) { h = ((g - b) / d) % 6; }
      else if (max === g) { h = (b - r) / d + 2; }
      else { h = (r - g) / d + 4; }
      h *= 60;
      if (h < 0) { h += 360; }
    }
    return { h: h, s: max ? d / max : 0, v: max };
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  /**
   * 打开取色器。onPick(hex) 在用户点「用这个颜色」时回调一次。
   * opts.title / opts.recommend（推荐色数组，比如课表里白字可读的一组）
   */
  function openColorPicker(initial, onPick, opts) {
    opts = opts || {};
    // 只允许存在一个取色浮层：重复打开时先把旧的收掉
    // （否则 document.querySelector('.cp-*') 会命中旧实例，取色行为看起来"没反应"）
    var olds = document.querySelectorAll('.cp-root');
    for (var oi = 0; oi < olds.length; oi++) {
      if (olds[oi].parentNode) { olds[oi].parentNode.removeChild(olds[oi]); }
    }
    var hex = /^#[0-9a-fA-F]{6}$/.test(String(initial || '')) ? String(initial) : '#5B8DEF';
    var rgb = hexToRgb(hex);
    var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

    var body = el('<div class="cp"></div>');
    var sv = el('<div class="cp-sv"><span class="cp-dot"></span></div>');
    var hue = el('<div class="cp-hue"><span class="cp-hthumb"></span></div>');
    var row = el('<div class="cp-hexrow"><span class="cp-preview"></span>'
      + '<input class="input cp-hex" maxlength="7" spellcheck="false" value="' + hex.toUpperCase() + '"></div>');
    body.appendChild(sv);
    body.appendChild(hue);
    body.appendChild(row);

    var recent = recentColors();
    if (recent.length) {
      body.appendChild(el('<div class="cp-label">最近用过</div>'));
      var rbox = el('<div class="cp-chips"></div>');
      for (var i = 0; i < recent.length; i++) {
        (function (h) {
          var b = el('<button class="cp-chip" type="button" style="background:' + h + '" title="' + h + '"></button>');
          b.addEventListener('click', function () { setHex(h, true); });
          rbox.appendChild(b);
        })(recent[i]);
      }
      body.appendChild(rbox);
    }

    var rec = opts.recommend || ['#2F6FD0', '#2B7FB8', '#1E8FA6', '#2F8F63', '#4C8B3A', '#C08A2E',
      '#B4762B', '#C0504A', '#B04A73', '#9A4FA8', '#6B7A93', '#5A6072'];
    body.appendChild(el('<div class="cp-label">推荐（深色底白字清晰）</div>'));
    var pbox = el('<div class="cp-chips"></div>');
    for (var p = 0; p < rec.length; p++) {
      (function (h) {
        var b = el('<button class="cp-chip" type="button" style="background:' + h + '" title="' + h + '"></button>');
        b.addEventListener('click', function () { setHex(h, true); });
        pbox.appendChild(b);
      })(rec[p]);
    }
    body.appendChild(pbox);

    var dot = sv.querySelector('.cp-dot');
    var hthumb = hue.querySelector('.cp-hthumb');
    var preview = row.querySelector('.cp-preview');
    var hexInput = row.querySelector('.cp-hex');

    function paint() {
      var base = hsvToRgb(hsv.h, 1, 1);
      sv.style.background = 'linear-gradient(to top, #000, rgba(0,0,0,0)),'
        + 'linear-gradient(to right, #fff, ' + rgbToHex(base.r, base.g, base.b) + ')';
      hue.style.background = 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';
      dot.style.left = (hsv.s * 100) + '%';
      dot.style.top = ((1 - hsv.v) * 100) + '%';
      hthumb.style.left = (hsv.h / 360 * 100) + '%';
      var c = hsvToRgb(hsv.h, hsv.s, hsv.v);
      var cur = rgbToHex(c.r, c.g, c.b);
      preview.style.background = cur;
      if (document.activeElement !== hexInput) { hexInput.value = cur.toUpperCase(); }
    }

    function setHex(h, keepHue) {
      if (!/^#[0-9a-fA-F]{6}$/.test(h)) { return; }
      var c = hexToRgb(h);
      var v = rgbToHsv(c.r, c.g, c.b);
      if (keepHue && v.s === 0) { v.h = hsv.h; }     // 灰阶时保留原来的色相，拖起来更顺手
      hsv = v;
      paint();
    }

    function drag(host, onMove) {
      var active = false;
      function apply(ev) {
        var r = host.getBoundingClientRect();
        var x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        var y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
        onMove(x, y);
        paint();
      }
      host.addEventListener('pointerdown', function (ev) {
        active = true;
        try { host.setPointerCapture(ev.pointerId); } catch (e) { }
        apply(ev);
        ev.preventDefault();
      });
      host.addEventListener('pointermove', function (ev) { if (active) { apply(ev); } });
      host.addEventListener('pointerup', function () { active = false; });
      host.addEventListener('pointercancel', function () { active = false; });
    }

    drag(sv, function (x, y) { hsv.s = x; hsv.v = 1 - y; });
    drag(hue, function (x) { hsv.h = x * 360; });
    hexInput.addEventListener('input', function () {
      var v = hexInput.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v)) { setHex(v.charAt(0) === '#' ? v : '#' + v, false); }
    });
    paint();

    /**
     * 独立浮层（不是复用主弹窗）。
     * 主弹窗（课程编辑器）是"同一张卡片原地换内容"，如果取色器也用它，
     * 选完颜色编辑器就被顶掉了 —— 点几次颜色就得重新打开编辑器。
     * 这里自己在 body 上挂一层，盖在编辑器上面，关掉后编辑器还在原处。
     */
    var root = el('<div class="cp-root"></div>');
    var scrim = el('<div class="modal-scrim"></div>');
    var card = el('<div class="modal-card cp-card"></div>');
    var head = el('<div class="modal-head"><div><h3 class="modal-title">' + U.escapeHtml(opts.title || '选择颜色')
      + '</h3><p class="modal-sub">拖方块调深浅、拖色条换色相，也可以直接填十六进制</p></div>'
      + '<button class="modal-close" type="button">✕</button></div>');
    var bodyWrap = el('<div class="modal-body"></div>');
    bodyWrap.appendChild(body);
    var actions = el('<div class="modal-actions"></div>');
    var cancelBtn = el('<button class="btn" type="button">取消</button>');
    var useBtn = el('<button class="btn primary" type="button">用这个颜色</button>');
    actions.appendChild(cancelBtn);
    actions.appendChild(useBtn);
    card.appendChild(head);
    card.appendChild(bodyWrap);
    card.appendChild(actions);
    root.appendChild(scrim);
    root.appendChild(card);
    document.body.appendChild(root);

    function closePicker() {
      root.classList.remove('open');
      popIn(card, 'out');
      setTimeout(function () {
        if (root.parentNode) { root.parentNode.removeChild(root); }
      }, Math.round(260 / motionSpeed()));
    }
    head.querySelector('.modal-close').addEventListener('click', closePicker);
    cancelBtn.addEventListener('click', closePicker);
    scrim.addEventListener('click', closePicker);
    useBtn.addEventListener('click', function () {
      var c = hsvToRgb(hsv.h, hsv.s, hsv.v);
      var out = rgbToHex(c.r, c.g, c.b);
      pushRecentColor(out);
      AR.Bridge.haptic('medium', useBtn);
      closePicker();
      if (onPick) { onPick(out); }
    });
    // 进场：和主弹窗同一套曲线（这里单独播，不动主弹窗的栈）
    popIn(card, 'in');
    setTimeout(function () { root.classList.add('open'); }, 10);
  }

  function applyGlass() {
    var lvl = S.settings.appearance.glassLevel || 'medium';
    var degraded = AR.Bridge.sdkInt && AR.Bridge.sdkInt() > 0 && AR.Bridge.sdkInt() < 31;
    document.body.setAttribute('data-degraded', degraded && lvl !== 'off' ? 'on' : 'off');
    document.body.setAttribute('data-glass', lvl);
    AR.Bridge.setBackdrop(lvl !== 'off');
  }

  function applyMotion() {
    var ap = S.settings.appearance;
    var speed = Number(ap.animationSpeed) || 1;
    var root = document.documentElement;
    document.body.removeAttribute('data-motion');
    // 规格书里的时长令牌全是 calc(... * var(--motion-scale))，所以「动画速度」必须改
    // --motion-scale 才会真的生效；之前只改了旧的 --dur-* 变量，等于没生效。
    root.style.setProperty('--motion-scale', String(Math.round((1 / speed) * 1000) / 1000));
    root.style.setProperty('--dur-instant', Math.round(120 / speed) + 'ms');
    root.style.setProperty('--dur-quick', Math.round(180 / speed) + 'ms');
    root.style.setProperty('--dur-standard', Math.round(240 / speed) + 'ms');
    root.style.setProperty('--dur-focus', Math.round(300 / speed) + 'ms');
  }

  AR.UI = {
    init: init,
    show: show,
    toast: toast,
    renderToday: renderToday,
    renderWeek: renderWeek,
    renderSettings: function () { if (AR.Panels && AR.Panels.renderSettings) { AR.Panels.renderSettings(); } },
    renderImport: function () { if (AR.Panels && AR.Panels.renderImport) { AR.Panels.renderImport(); } },
    openModal: openModal,
    closeModal: closeModal,
    popIn: popIn,
    openCourseModal: openCourseModal,
    openBlockEditor: openBlockEditor,
    openLocationModal: openLocationModal,
    openTimeModal: openTimeModal,
    openTeacherModal: openTeacherModal,
    openNoteModal: openNoteModal,
    applyTheme: applyTheme,
    applyGlass: applyGlass,
    applyMotion: applyMotion,
    applyLayout: applyLayout,
    setPreset: setPreset,
    setSize: setSize,
    setExpanded: setExpanded,
    expanded: function () { return Layout.expanded; },
    syncSegPill: syncSegPill,
    flashButton: flashButton,
    enterRise: enterRise,          // 开发者模式的「页面入场」试放
    fadeInList: fadeInList,        // 开发者模式的「列表入场」试放
    openColorPicker: openColorPicker,
    openDayShift: openDayShift,
    openQuickAdd: openQuickAdd,
    devApply: devApply,
    devFlags: devFlags,
    devDiagnostics: devDiagnostics,
    sizeOf: sizeOf,
    itemStartPeriod: itemStartPeriod,
    itemEndPeriod: itemEndPeriod,
    saveProfiles: saveProfiles,
    defaultProfiles: function () { return U.deepCopy(DEFAULT_PROFILES); },
    breakpointKey: breakpointKey,
    layoutState: Layout,
    currentView: function () { return currentView; },
    modalOpen: function () { return modalStack.length > 0; }
  };
})();
