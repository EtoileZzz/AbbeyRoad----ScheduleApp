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
  var railScrollX = 0;       // 「本周概览」展开态横向滚动位置（跨重画保留）
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

  /**
   * 左手模式：设置 → 布局与尺寸 里的开关。
   * 只对「左右」布局有意义（「上中下」本来就没有左右之分），
   * 打开后把整块版图左右镜像：「最近的课」到左边，本周概览 + 今日日程 到右边。
   */
  function leftHandOn() {
    return !!(S.settings && S.settings.layout && S.settings.layout.leftHand);
  }

  /**
   * 把算好的矩形整体左右镜像：x' = W - x - w。
   *
   * 为什么在矩形这一层做，而不是在 CSS 里 flex-direction: row-reverse：
   * 三栏的位置全由 rectsFor 算出来的像素矩形说了算（展开/收起只是换个矩形），
   * 所以镜像放在这里，展开态（左 70% / 右 30% 之类）也会一起跟着镜像，
   * 平移动画补的还是同一批矩形，不需要任何额外分支。
   */
  function mirrorRects(out, W) {
    for (var k in out) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) { continue; }
      var r = out[k];
      if (!r) { continue; }
      r.x = Math.max(0, W - r.x - r.w);
    }
    return out;
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
    // 左手模式：整体镜像（「最近的课」换到左侧）
    if (leftHandOn()) { mirrorRects(out, W); }
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
      /**
       * 「本周概览」的内容是一张表格：整块淡入看不出结构，所以额外让
       * 日期格与课程块**按列错峰**浮入（周一到周日依次出现）。
       * 参数同样取自 AR.Motion 的「卡片内容 · 浮入」，开发者模式换样式时
       * 这张表跟着一起变 —— 放大和收起走的是同一套接口。
       */
      if (k === 'week') { playWeekCells(node, isNext, style, speed); }
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
   * 「本周概览」放大 / 收起时，表格内容按列错峰浮入。
   *
   *   · 时长 / 曲线 / 位移 / 缩放全部取自 AR.Motion 的「卡片内容 · 浮入」场景，
   *     开发者模式里换样式，这张表跟着一起变（和其它页面同一套接口）；
   *   · 错峰按"列"走（周一 → 周日依次出现），不是按元素顺序 ——
   *     一列里 4 个课程块同时出现，读起来才是"哪天有课"而不是"一堆砖头"；
   *   · 只动 opacity / transform，一行 7 列最多 26 个元素，手机上也很轻。
   */
  function playWeekCells(zone, next, style, speed) {
    var table = zone && zone.querySelector ? zone.querySelector('.mini-table, .week-table') : null;
    if (!table) { return; }
    var m = style || { dur: 300, ease: 'expo', y: 10, s: .986 };
    var dur = Math.round((m.dur || 0) / (speed || 1));
    if (!dur) { return; }                        // 「不要内容动画」样式：直接落位
    var ease = AR.Motion ? AR.Motion.ease(m.ease) : 'cubic-bezier(.16,1,.30,1)';
    var gap = Math.round(((m.fxStagger != null ? m.fxStagger : (m.stagger != null ? m.stagger : 34))) / (speed || 1));
    var y = next ? (m.y || 0) : Math.min(m.y || 0, 6);
    var s = next ? (m.s == null ? 1 : m.s) : 1;
    var from = [];
    if (y) { from.push('translate3d(0,' + y + 'px,0)'); }
    if (s !== 1) { from.push('scale(' + s + ')'); }
    var frames = [
      { opacity: 0, transform: from.length ? from.join(' ') : 'none' },
      { opacity: 1, transform: 'none' }
    ];
    /**
     * 只动课程块和事件块（日期格 / 节次列保持不动，它们本来就该是"标尺"），
     * 并且整组延后 70ms 起步：
     *   · 放大那一帧要做的事最多（重建三栏 + 补间几何），内容晚一拍再进，
     *     重活和"内容动起来"就不挤在同一帧里，观感明显更顺；
     *   · 栏框已经在长了，内容随后落定，节奏本身也更像"盒子长开、内容填进来"。
     */
    var cells = table.querySelectorAll('.mg-block, .wt-block, .ev-chip');
    if (!cells.length) { return; }
    var base = Math.round(70 / (speed || 1));
    for (var i = 0; i < cells.length; i++) {
      var node = cells[i];
      if (!node.animate) { continue; }
      var col = parseInt(String(node.style.gridColumn || '1').split(/[\s\/]/)[0], 10) || 1;
      if (node.__wAnim) { try { node.__wAnim.cancel(); } catch (e) { } }
      node.__wAnim = node.animate(frames, {
        duration: dur,
        delay: base + Math.max(0, Math.min(col - 1, 6)) * gap,
        easing: ease,
        fill: 'backwards'
      });
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
    // fxStagger 显式为 0（流畅模式·深度）时要当 0 用，不能被 || 吃回默认值
    var stagger = Math.round(((style.fxStagger != null ? style.fxStagger : 55)) / speed);
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

    if (fx === 'zoom' || fx === 'zoomOut') {
      // 流畅模式的便宜等价：只动 opacity / scale，无 filter、无 3D
      frames = (fx === 'zoom')
        ? [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }];
    } else if (fx === 'cascade' || fx === 'mosaic') {
      kids = body.querySelectorAll('.strip, .info-cell, .next-hero, .card, .zone-compact, .ev-strip, .zone-tools');
      for (i = 0; i < kids.length; i++) {
        k = kids[i];
        if (!k.animate) { continue; }
        if (k.__fx) { try { k.__fx.cancel(); } catch (e) { } k.__fx = null; }
        var from = (fx === 'cascade')
          ? { opacity: 0, transform: 'translate3d(0,-24px,0)' }
          : { opacity: 0, transform: 'translate3d(0,16px,0) scale(.86) rotate(-2deg)' };
        k.__fx = k.animate([from, { opacity: 1, transform: 'none' }], {
          duration: dur, delay: i * stagger, easing: ease, fill: 'backwards'
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
    syncDayPillSoon();                // 卡片尺寸变了，日期滑块要重新贴一次
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
       * 只要这一栏尺寸在变，就把内容按"最终尺寸"钉住：
       *   · 放大：内容一次排好版，被栏框一点点露出来（不会"框在长、字在跳"）；
       *   · 缩小：内容已经换成缩略图 / 摘要，若让它跟着每一帧的宽度重排，
       *     就是"7 列 × 十几块课卡"逐帧重排 —— 收起时那几帧卡顿主要来自这里。
       *     钉在最终尺寸后动画期间零重排，补间结束再解冻。
       * 三栏都这么做，收起时另外两栏（今日日程 / 最近的课）同样受益。
       */
      if (Math.abs(b.w - a.w) > 0.5 || Math.abs(b.h - a.h) > 0.5) { freezeInner(node, b); }
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
          syncDayPillSoon();                  // 真实布局落定后，把日期滑块贴回去
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
      质感模糊效果: S.settings.appearance.glassLevel,
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
    if (view !== 'today') { collapseDoneGroups(); }   // 离开今日页：作业展开状态一并重置
    if (view === 'week') { renderWeek(); }
    if (view === 'settings' && AR.Panels) { AR.Panels.renderSettings(); }
    if (view === 'import' && AR.Panels) { AR.Panels.renderImport(); }
    // 规格书 4.1：整屏区块 60ms 错峰入场
    var viewEl = $('view-' + view);
    enterRise(viewEl);
    // 切页：本页所有滑块（含底部 Tab 栏那颗）落位 + 播一次统一的进场淡入
    enhanceSegmented(viewEl, true);
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
    /**
     * 今日日程的卡片密度（设置 → 布局与尺寸 里的开关，默认开）：
     *   紧凑（默认）—— 每节课一条长卡片（时间 / 课名 / 地点 / 老师），
     *                 一屏能看下整整一天的课，点卡片看详情 + 编辑；
     *   详细        —— 每节课带 6 个信息格 + 快捷按钮，可以逐格点开改，
     *                 代价是一节课占掉半屏，课多时要滑很久。
     */
    var todayCompact = !(S.settings.appearance && S.settings.appearance.todayCompact === false);

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
          var at = remindAt(startMs);          // 默认提前 15 分钟（设置 → 系统集成）
          AR.Bridge.addCalendarEvent(first.course.name, first.location ? first.location.raw : '',
            'Abbey Road 课表 · ' + first.periodLabel, at.ms, endMs);
          AR.Bridge.haptic('medium', tools);
        });
        body.appendChild(tools);
      }
      if (isToday) {
        body.appendChild(el('<div class="now-line"><span class="dot"></span><span class="line"></span><span class="label">现在 '
          + U.timeKey(now) + '</span></div>'));
      }
      for (var i = 0; i < items.length; i++) {
        /**
         * 卡片形态：
         *   紧凑（默认，展开/收起都用）→ todayCompactRow：两行一条，一天一眼看完；
         *                                收起态点它 = 放大这一栏，展开态点它 = 看详情 + 编辑
         *   详细（设置里关掉紧凑）      → 展开态用 todayDetailCard（6 个信息格，可逐格改），
         *                                收起态用 todayCard（原来的长条卡片）
         */
        body.appendChild(todayCompact
          ? todayCompactRow(items[i], now, isToday)
          : (detailed ? todayDetailCard(items[i], now, isToday) : todayCard(items[i], now, isToday)));
      }
      /* 特殊事件（考试 / 讲座 / 活动）也按长条卡片列在今天里 */
      var dayEvents = AR.Store.eventsOf ? AR.Store.eventsOf(cursorDate) : [];
      for (var ei = 0; ei < dayEvents.length; ei++) {
        body.appendChild(eventStrip(dayEvents[ei]));
      }
      fadeInList(body, '.card, .strip');            // 规格书 4.2：列表只做淡入
    }

    /**
     * 今日日程最下面这一条：作业汇总（点开就地展开成条目列表）。
     * 内容来自「本次备注」里识别出来的条目：今天课上的 + 之前没划掉的，
     * 今天划掉的进「已完成」，更早划掉的自动隐藏（仍可找回）。
     */
    /**
     * 作业卡片出现的条件：作业功能开着，**或者**有长期任务要显示。
     * （长期任务是独立的一张表，不该因为关掉"作业识别"就连它一起消失。）
     */
    if (hwZoneVisible()) { body.appendChild(homeworkNode('today')); }

    /* 左侧：本周概览 */
    renderWeekRail(weekNo, sem, ex === 'week', weekCompact);

    /* 右侧：最近的课 */
    renderNextPanel(now, ex === 'next', nextCompact);

    /* 桌面卡片：把最新快照交给原生外壳（防抖 400ms，渲染期间不打扰） */
    if (AR.WidgetData && AR.WidgetData.sync) { AR.WidgetData.sync(); }
  }

  /**
   * 今日日程（展开态 + 紧凑开关打开，默认）：**两行**看完一节课。
   *   第一行：时间 + 课名（+ 连堂/调整标签 + 状态）
   *   第二行：地点 + 老师 + 节次
   * 信息一个不少，但一节课只占 50–60px —— 一天 6 节课也不用滑很久；
   * 点整条卡片打开课程详情，编辑入口都在那里。
   */
  function todayCompactRow(item, now, isToday) {
    var status = isToday ? relativeText(item, now) : '';
    var teachers = item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '';
    var badges = '';
    if (item.isConsecutive) { badges += '<span class="tag">连堂</span>'; }
    if (item.kind !== 'normal') { badges += '<span class="tag warn">' + kindLabel(item.kind) + '</span>'; }
    // 上完的课压暗一点：一眼看出进度，又不用再占一行写「已结束」
    var dim = status === '已结束' ? ' style="opacity:.55"' : '';
    var node = el('<div class="strip dense"' + dim + '>'
      + '<span class="st-bar" style="background:' + item.color + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-line1">'
      + '<span class="st-time">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="st-title">' + U.escapeHtml(item.course.name) + '</span>'
      + (badges ? '<span class="st-badges">' + badges + '</span>' : '')
      + '</div>'
      + '<div class="st-line2">'
      + '<span class="st-loc">' + U.escapeHtml(softParens(item.location ? item.location.raw : '地点待补全')) + '</span>'
      + (teachers ? '<span class="st-teacher">' + U.escapeHtml(teachers) + '</span>' : '<span class="st-teacher">老师待补全</span>')
      + '<span class="st-period">' + U.escapeHtml(item.periodLabel) + '</span>'
      + '</div>'
      + '</div></div>');
    node.addEventListener('click', function () {
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
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
      + '<div class="ic-v">' + U.escapeHtml(softParens(text || '未填写')) + '</div>'
      + ((opts && opts.extra) ? opts.extra : '') + '</button>');
    // 长按（备注格子：长按 = 改这门课的备注）
    if (opts && opts.onLongPress) { bindLongPress(node, opts.onLongPress); }
    node.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (node.__lpFired) { node.__lpFired = false; return; }   // 长按之后这次点击不算数
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
      var at = remindAt(startMs);
      AR.Bridge.addCalendarEvent(item.course.name, item.location ? item.location.raw : '',
        'Abbey Road 课表 · ' + item.periodLabel, at.ms, endMs);
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
    /**
     * 备注这一格分两层显示（v0.3.4）：
     *   本次备注 —— 照常显示（没有就是「（空）」），点它编辑这一次；
     *   本课备注 —— 只有写了才显示，长按这一格才能改。
     */
    var noteExtra = item.courseNote
      ? '<div class="ic-extra"><span class="ic-tag">本课</span>'
        + U.escapeHtml(softParens(item.courseNote)) + '</div>'
      : '';
    g3.appendChild(infoCell('备注', item.note || '（空）',
      function () { openNoteModal(item, 'once'); },
      { onLongPress: function () { openNoteModal(item, 'course'); }, extra: noteExtra }));
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

  /**
   * 「本周概览」一栏的渲染入口。
   *
   * 包一层的原因：日期滑块是画在表格里的，每次重画表格都会把它冲掉，
   * 所以画完表格要立刻把滑块放回"选中的那一天" —— 首屏（还没点过日期）
   * 也得有这块滑块，否则看不出"今天/正在看的是哪一天"。
   */
  function renderWeekRail(weekNo, sem, expanded, compact) {
    renderWeekRailInner(weekNo, sem, expanded, compact);
    slideDayPill($('weekBody'));
  }

  function renderWeekRailInner(weekNo, sem, expanded, compact) {
    var body = $('weekBody');
    /**
     * 横向滚动位置要跨重画保留：点日期 / 改课 / 切布局都会重画这一栏，
     * 以前 scrollLeft 归零 —— 用户得重新滑回他想看的那几天（"点日期后要重新滑"）。
     */
    var prevWrap = body.querySelector('.wt-scroll');
    if (prevWrap) { railScrollX = prevWrap.scrollLeft; }
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
      /**
       * 「本周课表 / 月视图」也用和别处一样的胶囊滑块。
       * 注意要在插进 DOM 之后再量（否则 offsetWidth 是 0，滑块画不出来）；
       * 走的也是全局那一个滑块引擎（syncSegPill）：这一栏每次渲染都会重建 DOM，
       * 滑块位置记在 segMemos 里，重画后从旧位置续播过去。
       */
      syncSegPill(seg, true);
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
      /**
       * 展开态：整张周表（和「周表」页同一套结构，只是窄一点）。
       * 这里才是「本周概览」唯一可以左右滑动的地方：卡片窄的时候
       * 每天给 42px 下限，外面套 .wt-scroll 横向滑动，时间列 sticky 吸左；
       * 点课程块只弹"课程详情"，不带任何编辑入口（编辑在「周表」页）。
       */
      var railAvail = Math.max(0, body.clientHeight - 40);
      var railWrap = el('<div class="wt-scroll"></div>');
      railWrap.appendChild(weekTableNode(sem, Math.max(weekNo, 1),
        { narrow: true, clickDays: true, fitH: railAvail, detailOnly: true }));
      /**
       * 横向滑动时课程卡片会钻到"悬停的时间列"下面（重叠），
       * 一旦重叠就把这一列切成毛玻璃（见 app.css 的 .wt-stuck）。
       * 只在真的滑动了才换，没滑动时保持干净的不透明底色。
       */
      var stuckSync = function () {
        railWrap.classList.toggle('wt-stuck', railWrap.scrollLeft > 1);
      };
      railWrap.addEventListener('scroll', stuckSync, { passive: true });
      // 还原上一次的横向位置（重画后列宽一致，直接写回即可）
      if (railScrollX > 1) {
        railWrap.scrollLeft = railScrollX;
        requestAnimationFrame(function () {
          railWrap.scrollLeft = railScrollX;
          stuckSync();
        });
      }
      stuckSync();
      body.appendChild(railWrap);
      body.appendChild(weekEventList(sem, Math.max(weekNo, 1)));
      body.appendChild(el('<div class="mini-foot">点课程块看详情（只读）· 左右滑动看整周 · 点日期切换「今日」</div>'));
      return;
    }

    /**
     * 折叠态：缩略图（周一到周五 + 节次 + 色块），**不可滑动**，
     * 一屏看全工作日；周末有课时在下面提示里报一句。
     */
    /**
     * 把卡片可用高度交给缩略图：行高按它算，卡片高矮都保持"缩略"的比例。
     * 注意用的是 railBodyHeight()（按布局的**目标矩形**算），不是当前量到的
     * body.clientHeight —— 从展开态往回收的那一帧量到的还是展开时的大尺寸，
     * 行高会被算到 20px 上限，缩略图看着就像被拉长了一截。
     */
    var mini = weekTableNode(sem, Math.max(weekNo, 1),
      { mini: true, fitH: Math.max(90, railBodyHeight(body) - 26) });
    mini.classList.add('rail-mini');
    body.appendChild(mini);
    fitMiniRows(mini);
    /**
     * 底部提示按优先级拼：选中的那天 → 周末几节课（缩略图不画周末）→ 操作提示。
     * 插进 DOM 量一下，真折成两行就削掉最后一段，保证只占一行。
     */
    var footParts = [U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)] + ' '
      + (cursorDate.getMonth() + 1) + '/' + cursorDate.getDate()];
    if (mini.__weekend) { footParts.push('周末 ' + mini.__weekend + ' 节'); }
    // 缩略图不响应点日期（要看别的日子先点开放大），所以提示只讲"怎么放大"
    footParts.push('点开看整周');
    var foot = el('<div class="mini-foot">' + footParts.join(' · ') + '</div>');
    body.appendChild(foot);
    while (footParts.length > 1 && foot.getBoundingClientRect().height > 20) {
      footParts.pop();
      foot.textContent = footParts.join(' · ');
    }
    if (footParts.length === 1) { fitMiniRows(mini); }
    return;
  }

  /**
   * 「本周概览」内容区（zone-body）的**目标高度**。
   *
   * 渲染可能发生在"从展开态往回收"的补间动画中间：那一刻量到的
   * body.clientHeight 还是展开时的大尺寸，缩略图行高就会被算到上限，
   * 看上去比刚启动时被拉长了一截（用户报的就是这个）。
   * 所以改用布局引擎算好的**目标矩形**高度，减去栏头 + 内边距
   * （这个差值只跟栏头有关，不随展开变化），得到的才是收起后真正可用的高度。
   */
  function railBodyHeight(body) {
    var zone = $('zoneWeek');
    var curZone = zone ? zone.getBoundingClientRect().height : 0;
    var curBody = body ? body.clientHeight : 0;
    var chrome = Math.max(0, curZone - curBody);          // 栏头 + 上下内边距
    /**
     * 目标高度要**自己按"收起态"算一遍**，不能读 Layout.rects：
     * setExpanded() 是先 renderToday()、后 applyLayout()，所以渲染那一刻
     * Layout.rects 还是上一态（展开）的目标矩形，读它等于拿展开高度算行高。
     */
    var target = 0;
    var el = Layout.el;
    var W = el ? el.clientWidth : 0, H = el ? el.clientHeight : 0;
    if (W && H) {
      var r = rectsFor(resolvedPreset(), null, Layout.profiles[Layout.profileKey], W, H);
      if (r && r.week) { target = r.week.h; }
    }
    if (!target) { target = (Layout.rects && Layout.rects.week) ? Layout.rects.week.h : curZone; }
    return Math.max(72, Math.round(target - chrome));
  }

  /**
   * 缩略图二次校准：插进 DOM 后按**真实溢出量**把行高压下去。
   *
   * 渲染时估算的表头高度和字体的实际高度总会差几个像素（主题、字号、
   * 有没有事件行都会变），结果就是卡片底部多出一条被裁掉的缝。
   * 这里插进 DOM 后直接量 `scrollHeight - clientHeight`，超多少就压多少，
   * 最多四轮，保证缩略图 + 底部提示恰好待在卡片里。
   */
  function fitMiniRows(table) {
    var body = table && table.parentNode;
    if (!body || !table) { return; }
    var rows = Number(table.__rows) || 1;
    var hasEv = !!table.querySelector('.mg-evcell, .mg-evlabel');
    /**
     * 最多两轮"量 → 算 → 写"：每写一次都会让浏览器立刻重排一次，
     * 以前最多四轮 = 四次强制重排，收起卡片时那一帧就是这么被拖长的。
     * 第一轮按溢出量一次算到位，第二轮只是校准（多数情况第一轮就收敛）。
     */
    for (var guard = 0; guard < 2; guard++) {
      var over = body.scrollHeight - body.clientHeight;
      if (over <= 0) { break; }
      var cur = parseFloat(table.style.getPropertyValue('--mg-row')) || 12;
      var next = Math.max(6, cur - Math.max(1, Math.ceil(over / rows)));
      if (next >= cur) { break; }
      table.style.setProperty('--mg-row', next + 'px');
      table.style.gridTemplateRows = 'auto ' + (hasEv ? 'auto ' : '')
        + 'repeat(' + rows + ', ' + next + 'px)';
      table.classList[next < 9 ? 'add' : 'remove']('mg-thin');
    }
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
      var dir = U.sameDay(cursorDate, new Date()) ? 0 : (new Date().getTime() > cursorDate.getTime() ? 1 : -1);
      cursorDate = new Date();
      monthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
      renderToday();
      playTodaySwitch(dir);
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
      /**
       * 圆点最多画 3 个；超过 3 节课就改成一个「n」小圆牌 —— 以前一律只画 3 个点，
       * 5 节课的日子看着和 3 节课一模一样，等于没显示。
       */
      var dots = '';
      if (items.length > 3) {
        dots = '<b class="n">' + items.length + '</b>';
      } else {
        for (var k = 0; k < items.length; k++) { dots += '<i></i>'; }
      }
      var cls = 'month-cell' + (inMonth ? '' : ' out')
        + (U.sameDay(d, today) ? ' today' : '')
        + (U.sameDay(d, cursorDate) ? ' selected' : '');
      var cell = el('<button class="' + cls + '" type="button"><span>' + d.getDate()
        + '</span><span class="dots">' + dots + '</span></button>');
      (function (dd, node) {
        node.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var dir = dd.getTime() > cursorDate.getTime() ? 1 : (dd.getTime() < cursorDate.getTime() ? -1 : 0);
          cursorDate = dd;
          AR.Bridge.haptic('light', node);
          renderToday();
          playTodaySwitch(dir);
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
      // 没有下一节课时，作业条目照样要出现在这张卡片里
      if (hwZoneVisible()) { body.appendChild(homeworkNode('next')); }
      return;
    }
    var item = target.item;
    var whenText = target.ongoing ? '正在进行' : (target.offsetDays === 0 ? '就在今天'
      : (target.offsetDays === 1 ? '明天' : target.offsetDays + ' 天后'));
    $('nextBadge').textContent = whenText;
    var st = nextStatusOf(target, now);      // 按离上课时间决定状态色（设置里可改）

    if (compact) {
      var hwN = hwVisibleInNext() ? hwOpenCount() : 0;
      body.appendChild(compactBlock(whenText, item.course.name + ' · ' + (item.start || '时间待定'),
        (hwN ? '作业 ' + hwN + ' 条' : (st ? st.label : '点开看课程详情')), st ? st.color : null));
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
        var at = remindAt(startMs);
        AR.Bridge.addCalendarEvent(item.course.name, item.location ? item.location.raw : '',
          'Abbey Road 课表 · ' + item.periodLabel + (item.note ? ' · ' + item.note : ''), at.ms, endMs);
      });
      nextTools.querySelector('[data-act="alarm"]').addEventListener('click', function () {
        var at = remindAt(toMs(target.day, item.start) || Date.now());
        AR.Bridge.setAlarm(at.h, at.m,
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
    /**
     * 当天所有课都上完之后（或者今天本来就没课），把今天的作业条目铺在这张卡片里。
     * 划掉的交互和「今日日程」里那条完全一样（左右滑 → 落进已完成区）。
     */
    if (hwZoneVisible() && hwVisibleInNext()) {
      body.appendChild(homeworkNode('next'));
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
    body.appendChild(el('<p class="muted" style="margin-top:-6px">长按某个学期可以改名或删除。</p>'));

    var box = el('<div class="export-list"></div>');
    for (var i = 0; i < list.length; i++) {
      (function (sem) {
        var isCur = cur && sem.id === cur.id;
        var courses = AR.Store.courseCountOfSemester(sem.id);
        var row = el('<button class="export-row' + (isCur ? ' active' : '') + '" type="button">'
          + '<span class="er-name">' + U.escapeHtml(sem.name) + (isCur ? ' · 当前' : '') + '</span>'
          + '<span class="er-meta">' + U.escapeHtml(sem.startDate || '') + ' 起 · ' + sem.weekCount + ' 周 · '
          + courses + ' 门课</span></button>');
        // 长按 → 改名 / 删除（弹窗走全局统一动画）
        bindLongPress(row, function () { openSemesterManage(sem); });
        row.addEventListener('click', function () {
          if (row.__lpFired) { row.__lpFired = false; return; }   // 长按之后的这次点击不算数
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

  /**
   * 通用「长按」绑定（默认 480ms）。
   * 用 pointerdown + 位移取消，手指滑动列表时不会误触；
   * 触发后把 __lpFired 置上，紧接着那次 click 会被调用方吃掉。
   */
  function bindLongPress(node, fn, ms) {
    if (!node || !node.addEventListener) { return; }
    var timer = null, x0 = 0, y0 = 0;
    function detach() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
    }
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; node.classList.remove('lp-wait'); }
      detach();
    }
    function move(e2) {
      if (Math.abs(e2.clientX - x0) > 10 || Math.abs(e2.clientY - y0) > 10) { cancel(); }
    }
    node.addEventListener('pointerdown', function (ev) {
      cancel();
      x0 = ev.clientX; y0 = ev.clientY;
      node.__lpFired = false;
      node.classList.add('lp-wait');
      timer = setTimeout(function () {
        timer = null;
        node.classList.remove('lp-wait');
        node.__lpFired = true;
        AR.Bridge.haptic('medium', node);
        fn();
      }, ms || 480);
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', cancel);
      node.addEventListener('pointercancel', cancel);
    });
    node.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  }

  /** 长按某个学期：改名 / 删除 / 取消（弹窗都是同一套统一动画） */
  function openSemesterManage(sem) {
    var cur = AR.Store.currentSemester();
    var isCur = cur && cur.id === sem.id;
    var courses = AR.Store.courseCountOfSemester(sem.id);
    var blocks = AR.Store.blockCountOfSemester ? AR.Store.blockCountOfSemester(sem.id) : 0;
    var body = el('<div>'
      + '<p class="muted" style="margin-top:0">' + U.escapeHtml(sem.startDate || '') + ' 起 · '
      + sem.weekCount + ' 周 · ' + courses + ' 门课 · ' + blocks + ' 节课'
      + (isCur ? ' · 当前正在用' : '') + '</p></div>');
    var rowBox = el('<div class="export-list"></div>');
    var renameRow = el('<button class="export-row" type="button">'
      + '<span class="er-name">重命名学期</span>'
      + '<span class="er-meta">只改名字，课表内容一动不动</span></button>');
    renameRow.addEventListener('click', function () {
      AR.Bridge.haptic('light', renameRow);
      openSemesterRename(sem);
    });
    rowBox.appendChild(renameRow);
    var delRow = el('<button class="export-row danger" type="button">'
      + '<span class="er-name">删除学期</span>'
      + '<span class="er-meta">连同它的 ' + courses + ' 门课 / ' + blocks + ' 节课一起删掉</span></button>');
    delRow.addEventListener('click', function () {
      AR.Bridge.haptic('warn', delRow);
      openSemesterDelete(sem, courses, blocks);
    });
    rowBox.appendChild(delRow);
    body.appendChild(rowBox);
    openModal({
      title: U.escapeHtml(sem.name), sub: isCur ? '当前学期' : '其它学期',
      body: body,
      actions: [{ label: '关闭', onClick: function (c) { c(); } }]
    });
  }

  /** 重命名学期 */
  function openSemesterRename(sem) {
    var body = el('<div><div class="field"><label class="field-label">学期名称</label>'
      + '<input class="input" id="semRenameInput" maxlength="24" value="' + U.escapeHtml(sem.name) + '"></div>'
      + '<p class="muted" style="margin-bottom:0">改名不影响课表、周次和提醒，导出到别的设备也是新名字。</p></div>');
    openModal({
      title: '重命名学期', sub: (sem.startDate || '') + ' 起 · ' + sem.weekCount + ' 周',
      body: body,
      actions: [
        {
          label: '保存', kind: 'primary', onClick: function (c) {
            var input = $('semRenameInput');
            var name = String((input && input.value) || '').trim();
            if (!name) { AR.UI.toast('学期名称不能为空'); return; }
            var res = renameSemesterDeep(sem, name);
            if (!res.ok) { AR.UI.toast(res.message || '改名失败'); return; }
            c();
            toast('已改名为「' + name + '」');
            finishSemesterEdit();
          }
        },
        { label: '取消', onClick: function (c) { c(); openSemesterManage(sem); } }
      ]
    });
    var input = $('semRenameInput');
    if (input) { setTimeout(function () { input.focus(); input.select(); }, 60); }
  }

  /** 删除学期：先二次确认，再连同课 / 课块 / 调课 / 作息 / 事件一起删 */
  function openSemesterDelete(sem, courses, blocks) {
    var isCur = (AR.Store.currentSemester() || {}).id === sem.id;
    var last = AR.Store.semesterList().length <= 1;
    var body = el('<div>'
      + '<p class="muted" style="margin-top:0">要删除「' + U.escapeHtml(sem.name) + '」吗？</p>'
      + '<p class="muted">会一并删掉它的 <b>' + courses + '</b> 门课、<b>' + blocks + '</b> 节课'
      + '（含调课 / 停课记录）和这段时间里的特殊事件。'
      + (last ? '<br>这是唯一一个学期，不能删。' : (isCur ? '<br>删掉之后会自动切到剩下的第一个学期。' : ''))
      + '</p></div>');
    openModal({
      title: '删除学期', sub: sem.startDate + ' 起 · ' + sem.weekCount + ' 周',
      body: body,
      actions: [
        {
          label: last ? '不能删除' : '删除', kind: last ? '' : 'danger',
          onClick: function (c) {
            if (last) { c(); return; }
            var res = deleteSemesterDeep(sem);
            if (!res.ok) { AR.UI.toast(res.message || '删除失败'); return; }
            c();
            toast('已删除「' + sem.name + '」');
            finishSemesterEdit();
          }
        },
        { label: '取消', onClick: function (c) { c(); openSemesterManage(sem); } }
      ]
    });
  }

  /** 学期改动之后：三栏重画 + 回到学期列表（弹窗动画照旧走统一接口） */
  function finishSemesterEdit() {
    weekCursor = null;
    renderToday();
    if (currentView === 'week') { renderWeek({ swap: 0 }); }
    setTimeout(function () { openSemesterPicker(); }, 60);
  }

  /** 改名：只动名字（课表、周次都不受影响） */
  function renameSemesterDeep(sem, name) {
    var S = AR.Store.get();
    for (var i = 0; i < S.semesters.length; i++) {
      if (S.semesters[i].id !== sem.id && S.semesters[i].name === name) {
        return { ok: false, message: '已经有同名学期了' };
      }
    }
    sem.name = name;
    sem.updatedAt = new Date().toISOString();
    AR.Store.save(true);
    return { ok: true };
  }

  /** 删除：学期 + 它的课程 / 课块 / 调课记录 / 作息 / 这段时间的事件 */
  function deleteSemesterDeep(sem) {
    var S = AR.Store.get();
    if ((S.semesters || []).length <= 1) { return { ok: false, message: '至少要留一个学期' }; }
    var courseIds = {};
    var i;
    for (i = 0; i < S.courses.length; i++) {
      if (S.courses[i].semesterId === sem.id) { courseIds[S.courses[i].id] = 1; }
    }
    var blockIds = {};
    for (i = 0; i < S.blocks.length; i++) {
      if (courseIds[S.blocks[i].courseId]) { blockIds[S.blocks[i].id] = 1; }
    }
    var from = U.parseDateKey(sem.startDate);
    var to = from ? U.addDays(from, Math.max(1, sem.weekCount) * 7 - 1) : null;
    S.blocks = S.blocks.filter(function (b) { return !blockIds[b.id]; });
    S.overrides = (S.overrides || []).filter(function (o) { return !blockIds[o.blockId]; });
    S.courses = S.courses.filter(function (c) { return c.semesterId !== sem.id; });
    S.periods = (S.periods || []).filter(function (p) { return p.semesterId !== sem.id; });
    S.events = (S.events || []).filter(function (ev) {
      if (!from || !to) { return true; }
      var d = U.parseDateKey(ev.date);
      return !(d && d >= from && d <= to);
    });
    S.semesters = S.semesters.filter(function (x) { return x.id !== sem.id; });
    if (S.settings.schedule.currentSemesterId === sem.id) {
      S.settings.schedule.currentSemesterId = S.semesters[0].id;
      AR.Store.claimPeriodsFor(S.semesters[0].id);
    }
    AR.Store.save(true);
    cursorDate = new Date();
    return { ok: true };
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
      /**
       * 周表页的「周视图 / 月视图」也用滑块：这个控件是静态 DOM（不重建），
       * 所以直接让 syncSegPill 带补间跑——胶囊会从原来那一格滑到新的那一格，
       * 时长 / 曲线和别处的分段控件完全一致。
       */
      syncSegPill(modeBox, true);
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
    /**
     * 缩略图（「本周概览」折叠态）只画**周一到周五**：
     * 卡片本来就窄，5 列才排得开、能一屏看全，而且不需要任何横向滑动 ——
     * 滑动只留给"点开聚焦放大"之后的整张周表。
     * 周末有课时在底部提示里报一句"周末 N 节"，不会丢信息。
     */
    var dayNums = mini ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7];
    /**
     * 缩略图平时只画周一到周五；但"正在看的那天"如果落在周末，
     * 就把它单独补成第 6 列 —— 否则缩略图上既没有滑块、也没有那天的框，
     * 用户看到的就是"缩小之后框没了"。
     */
    if (mini) {
      var cw = U.weekdayOf(cursorDate);
      if (cw > 5 && dayNums.indexOf(cw) < 0) { dayNums = dayNums.slice(); dayNums.push(cw); }
    }
    var periods = AR.Store.periodsOf(sem.id);
    var monday = U.addDays(U.mondayOf(U.parseDateKey(sem.startDate)), (weekNo - 1) * 7);
    var today = U.startOfDay(new Date());

    // 这一周实际用到多少节
    var byIndex = {};
    for (var pi = 0; pi < periods.length; pi++) { byIndex[periods[pi].index] = periods[pi]; }
    var maxUsed = 0, weekTotal = 0, weekendTotal = 0;
    var dayItems = [];
    for (var d = 1; d <= 7; d++) {
      var its = AR.Schedule.weekItems(weekNo, d);
      dayItems[d - 1] = its;
      weekTotal += its.length;
      if (d > 5) { weekendTotal += its.length; }
      for (var i = 0; i < its.length; i++) {
        var endIdx = itemEndPeriod(its[i]);
        if (endIdx > maxUsed) { maxUsed = endIdx; }
      }
    }
    if (!maxUsed) { maxUsed = Math.min(periods.length || 8, mini ? 5 : 8); }
    /**
     * 行数 = 这一周实际用到的最大节次，**不封顶**。
     * 以前缩略图写死最多 6 行，第 7 节以后的课（晚课）在缩略图里根本看不见；
     * 现在有几节画几节，行高再按卡片高度自适应（9–20px，太挤时降到 6px 并
     * 隐掉左边的节次数字），比例不变、卡片不滚动。
     */
    var rows = Math.max(maxUsed, 1);

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
      /**
       * 缩略图的三条硬规矩：**周一到周五铺满一屏、不横滑、行高不许被撑大**。
       *   · 列：5 列平分卡片宽度（时间列 16px），永远不需要左右滑动；
       *   · 行：按卡片可用高度算，夹在 9–20px，绝不 1fr 撑满 ——
       *     缩略图就该是缩略图，不是把一节课拉成一块大色砖；
       *   · 表头：上面一行写「一…五」，下面一行写日期，很窄也看得懂。
       */
      var mHeadH = evRow ? 38 : 24;                 // 表头（+事件行）的估算高度
      var mGaps = Math.max(0, rows - 1 + (evRow ? 1 : 0)) * 2;
      var mRowH = 14;                               // 没有可用高度信息时的兜底
      if (opts.fitH) {
        mRowH = Math.floor((opts.fitH - mHeadH - mGaps) / rows);
      }
      mRowH = Math.max(6, Math.min(20, mRowH));
      /**
       * 列下限给 0：极窄的直板机（320px 逻辑宽）下卡片内容区只有 ~88px，
       * 5 列各留 16px 下限就装不下，第五列会被卡片裁掉（正是"周一~周五看不全"）。
       * 让列自己缩到刚好放下，日期数字只是排得紧一点，不会被裁。
       */
      table.style.gridTemplateColumns = '16px repeat(' + dayNums.length + ', minmax(0, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '')
        + 'repeat(' + rows + ', ' + mRowH + 'px)';
      table.style.setProperty('--mg-row', mRowH + 'px');
      // 行高太小时左边「第几节」的数字会糊在一起，索性只留色块
      if (mRowH < 9) { table.classList.add('mg-thin'); }
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
      /**
       * 本周概览展开态（narrow）：每列给 42px 下限 —— 卡片窄的时候
       * 外层 .wt-scroll 就能左右滑动看完整周（周表页不传 narrow，行为不变）。
       */
      table.style.gridTemplateColumns = (narrow ? '34px' : '38px')
        + ' repeat(7, minmax(' + (narrow ? 42 : 0) + 'px, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '') + 'repeat(' + rows + ', ' + rowH + 'px)';
      table.style.setProperty('--wt-row', rowH + 'px');
      // 优先级：先牺牲老师，再牺牲地点与上下课时间 —— 课名和节次永远保留
      if (rowH < 44) { table.classList.add('wt-dense'); }
      if (rowH < 34) { table.classList.add('wt-tight'); }
    }

    // 表头：左上角显示月份，其余列是「周X + 日期」（缩略图：上一行「一…五」+ 下一行日期）
    table.appendChild(el('<div class="' + (mini ? 'mg-corner' : 'wt-corner') + '" style="grid-row:1;grid-column:1">'
      + (monday.getMonth() + 1) + ' 月</div>'));
    for (var ci0 = 0; ci0 < dayNums.length; ci0++) {
      var dh = dayNums[ci0];
      var dDate = U.addDays(monday, dh - 1);
      /**
       * picked = 当前正在看的那天（cursorDate）。只有「本周概览」的两种形态会标，
       * 周表页保持原样（那边的"今天"高亮逻辑不动）。日期栏的滑块就吸在 picked 上。
       */
      var picked = (mini || opts.clickDays) && U.sameDay(dDate, cursorDate) ? ' picked' : '';
      var head = el('<div class="' + (mini ? 'mg-day' : 'wt-day') + (U.sameDay(dDate, today) ? ' today' : '')
        + picked
        + '" data-date="' + U.dateKey(dDate) + '" style="grid-row:1;grid-column:' + (ci0 + 2) + '">'
        + '<span class="w">' + (mini ? U.WEEKDAY_NAMES[dh].replace('周', '') : U.WEEKDAY_NAMES[dh]) + '</span>'
        + '<span class="n">' + dDate.getDate() + '</span></div>');
      /**
       * 只有「本周概览」聚焦放大后的整张周表才受理点日期切换。
       * 缩略图（折叠态）现在**不响应点击日期** —— 卡片本来就小，
       * 手指一碰就换掉"今天"太容易误触；想看别的日子先把卡片点开放大。
       */
      if (opts.clickDays) {
        (function (dd) {
          head.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var prevMs = cursorDate ? cursorDate.getTime() : 0;
            cursorDate = dd;
            var dir = prevMs ? (dd.getTime() > prevMs ? 1 : (dd.getTime() < prevMs ? -1 : 0)) : 0;
            AR.Bridge.haptic('medium', head);   // 切换日期：震动 + 有方向的过渡
            renderToday();
            playTodaySwitch(dir);
          });
        })(dDate);
      }
      table.appendChild(head);
    }

    // 事件行（第 2 行）：每天最多显示 2 条，颜色按类型区分
    if (evRow) {
      table.appendChild(el('<div class="' + (mini ? 'mg-evlabel' : 'wt-evlabel')
        + '" style="grid-row:2;grid-column:1">' + (mini ? '事' : '事件') + '</div>'));
      for (var ei = 0; ei < dayNums.length; ei++) {
        var ed = dayNums[ei];
        var cellBox = el('<div class="' + (mini ? 'mg-evcell' : 'wt-evcell')
          + '" style="grid-row:2;grid-column:' + (ei + 2) + '"></div>');
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

      for (var ci = 0; ci < dayNums.length; ci++) {
        var day = dayNums[ci];
        var col = ci + 2;
        if (occupied[row + '_' + day]) { continue; }
        var list = dayItems[day - 1];
        var hit = null;
        for (var k = 0; k < list.length; k++) {
          if (itemStartPeriod(list[k]) === pIdx) { hit = list[k]; break; }
        }
        if (!hit) {
          var emptyCell = el('<div class="' + (mini ? 'mg-empty' : 'wt-empty') + '" style="grid-row:'
            + (row + 2 + evRow) + ';grid-column:' + col + '"></div>');
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
            + ';grid-column:' + col + ';background:' + hit.color + '"></div>');
        } else {
          // 用 background-color（不是 background 简写）：CSS 里那层淡淡的渐变才不会被清掉；
          // 同时按颜色亮度决定白字还是深色字
          block = el('<div class="wt-block ' + contrastClass(hit.color) + '" style="grid-row:' + (row + 2 + evRow) + ' / span ' + span
            + ';grid-column:' + col + ';background-color:' + hit.color + '">'
            + '<span class="n">' + U.escapeHtml(hit.course.name) + '</span>'
            + (hit.location ? '<span class="l">' + U.escapeHtml(hit.location.raw) + '</span>' : '')
            + (hit.teachers.length ? '<span class="k">' + U.escapeHtml(hit.teachers.map(function (t) { return t.name; }).join('、')) + '</span>' : '')
            + '</div>');
        }
        (function (item) {
          block.addEventListener('click', function (ev) {
            if (mini) { ev.stopPropagation(); setExpanded('week'); return; }
            /**
             * 两种入口分工明确：
             *   · 周表页（默认）：点课程块 = 详细编辑器，星期 / 单双周 / 老师 / 地点都能改；
             *   · 本周概览展开态（detailOnly）：只看课程详情，不带任何编辑按钮。
             */
            if (opts.detailOnly) {
              ev.stopPropagation();
              openCourseModal(item, { readOnly: true });
              return;
            }
            openBlockEditor(item);
          });
        })(hit);
        table.appendChild(block);
      }
    }
    table.__total = weekTotal;
    table.__rows = rows;
    table.__weekend = weekendTotal;   // 缩略图只画周一到周五，周末的节数给底部提示用
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
                /**
                 * v0.3.8a：和"单节课改星期"（doSave）统一成同一套记录语义。
                 * 以前这里是"目标日一条 move + normal 才补 cancel"，别的 kind 一律
                 * removeOverride —— 和编辑器里同一个老毛病，还多两个：
                 * · 已有单次调整的课被调走：记录删了（换教室 / 备注全丢），
                 *   来源日又没有 cancel，模板课原地复活（调整丢了还多显示一节）；
                 * · 本来就是调过来的课（moved-in）两边都不处理：旧记录还指着来源日，两天都显示；
                 * · 补课 / 加课被写成模板 move 记录：合成 block 挂不上模板，这节直接消失。
                 * 现在：有单次记录的**整条搬到目标日**（调整字段原样保留），
                 * 没有记录的在目标日建 move；只有"模板本来就会在那天出现"的才在来源日补 cancel。
                 */
                var ov = (it.override && it.override.id) ? AR.Store.overrideById(it.override.id) : null;
                if (it.kind === 'makeup' || it.kind === 'add') {
                  // 补课 / 加课只活在自己的单次记录里：整体挪走即可
                  if (ov) {
                    ov.date = d;
                    ov.updatedAt = new Date().toISOString();
                    AR.Store.save(true);
                  }
                } else if (ov) {
                  ov.type = 'move';
                  ov.newDate = d;
                  ov.newWeekday = U.weekdayOf(dd);
                  ov.reason = '调休';
                  ov.date = d;
                  ov.updatedAt = new Date().toISOString();
                  AR.Store.save(true);
                  if (it.kind !== 'moved-in') {
                    AR.Store.upsertOverride(it.blockId, it.courseId, s, { type: 'cancel', newDate: null, reason: '调休' });
                  }
                } else {
                  AR.Store.upsertOverride(it.blockId, it.courseId, d, {
                    type: 'move', newDate: d, newWeekday: U.weekdayOf(dd), reason: '调休'
                  });
                  AR.Store.upsertOverride(it.blockId, it.courseId, s, { type: 'cancel', newDate: null, reason: '调休' });
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
    /** 节次选项（自绘下拉用）：主文字是「第 n 节」，时间为次要说明 */
    function periodOpts() {
      var out = [];
      for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        out.push({
          v: String(p.index), t: '第 ' + p.index + ' 节',
          sub: p.start && p.end ? (p.start + '-' + p.end) : ''
        });
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

    var weekdayOpts = [];
    for (var w = 1; w <= 7; w++) { weekdayOpts.push({ v: String(w), t: U.WEEKDAY_NAMES[w] }); }

    // 课程类型选项：空值 = 跟着课程名自动识别
    var trackOpts = [{ v: '', t: '自动识别（按课程名）' }];
    if (AR.Palette) {
      for (var ti = 0; ti < AR.Palette.tracks.length; ti++) {
        trackOpts.push({ v: AR.Palette.tracks[ti].key, t: AR.Palette.tracks[ti].label });
      }
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
      /**
       * 作用域开关：**所有课都有**。
       * 以前只有"补课 / 加课 / 没有模板"的课才显示这个开关，普通课压根选不了作用域；
       * 而且单双周与周次只在 scope=once 时被禁用 —— 那几门课就永远改不了这两项。
       */
      + '<div class="scope-switch" id="ebScope">'
      + '<button type="button" class="scope-btn' + (scope === 'once' ? ' active' : '') + '" data-scope="once">仅这次 · ' + U.escapeHtml(dayShort) + '</button>'
      + (realBlock ? '<button type="button" class="scope-btn' + (scope === 'all' ? ' active' : '') + '" data-scope="all">这门课的所有时段</button>' : '')
      + '<span class="scope-hint" id="ebScopeHint">' + (scope === 'once'
        ? '只改当天的这一节，其它周不动' : '改动会写进这门课的所有时段') + '</span></div>'
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
      + '<div class="pick-slot" data-slot="weekday"></div></div>'
      + '<div class="field edit-span"><label class="field-label">节次（第几节到第几节）</label>'
      + '<div class="row"><div class="pick-slot" style="flex:1 1 0" data-slot="pstart"></div>'
      + '<span class="muted edit-sep">到</span>'
      + '<div class="pick-slot" style="flex:1 1 0" data-slot="pend"></div></div></div>'
      + '<div class="field edit-span"><label class="field-label">上课时间</label>'
      + '<div class="row"><input class="input" type="time" id="ebStart" style="flex:1 1 0" value="' + U.escapeHtml(curStart) + '">'
      + '<span class="muted edit-sep">到</span>'
      + '<input class="input" type="time" id="ebEnd" style="flex:1 1 0" value="' + U.escapeHtml(curEnd) + '"></div>'
      + '<div class="muted" style="margin-top:4px">跟着节次自动填；改了这里只影响这门课，不动整张节次表</div></div>'
      + '<div class="field" id="ebWeekField"><label class="field-label">上课周次（对整门课生效）</label>'
      + '<div class="row"><div class="pick-slot" style="flex:0 0 120px" data-slot="weekmode"></div>'
      + '<input class="input" id="ebWeeks" style="flex:1 1 150px" placeholder="例如 1-8,10,12" value="'
      + U.escapeHtml(weekMode === 'custom' ? weekText : '') + '"></div>'
      + '<div class="muted" style="margin-top:4px">单双周也可以配合周次范围，如选「单周」再填 1-16</div></div>'
      // 备注分两层（和备注弹窗一致）：本次只影响这一天，本课所有时段共用
      + '<div class="field edit-span"><label class="field-label">本次备注 · 只改 ' + U.escapeHtml(dayShort) + ' 这一次</label>'
      + '<textarea class="input" id="ebNote" rows="3" placeholder="作业：习题 3-5&#10;复习第四章">'
      + U.escapeHtml(item.note || '') + '</textarea>'
      + '<div class="muted" style="margin-top:4px">每一行会自动变成今日页的一条作业</div></div>'
      + '<div class="field edit-span"><label class="field-label">本课备注 · 这门课所有时段</label>'
      + '<textarea class="input" id="ebNoteCourse" rows="2" placeholder="例如：每次都要带计算器">'
      + U.escapeHtml(item.courseNote || '') + '</textarea></div>'
      + '<div class="field edit-span"><label class="field-label">课程颜色</label>'
      + '<div class="swatches" id="ebColors">' + swatchHtml + '</div>'
      + '<div class="row color-custom">'
      + '<button class="btn color-open" type="button" id="ebColorPick">'
      + '<span class="co-dot" id="ebColorDot" style="background:' + customHex + '"></span>打开色盘</button>'
      + '<span class="muted">饱和/明度方块 + 色相条，也能直接填 #RRGGBB</span></div></div>'
      + '<div class="field edit-span"><label class="field-label">课程类型（影响配色方案）</label>'
      + '<div class="pick-slot" data-slot="track"></div>'
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
        var at = remindAt(startMs);
        AR.Bridge.addCalendarEvent(item.course.name, place,
          'Abbey Road 课表 · ' + (item.periodLabel || '') + (item.note ? ' · ' + item.note : ''),
          at.ms, endMs || (startMs + 45 * 60000));
        AR.Bridge.haptic('medium', tools);
      });
      tools.querySelector('[data-act="alarm"]').addEventListener('click', function () {
        var at = remindAt(toMs(day, item.start) || Date.now());
        AR.Bridge.setAlarm(at.h, at.m, item.course.name + (place ? ' ' + place : ''));
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
      /**
       * 单双周 / 周次**不再置灰**：它们是"整门课的排课规则"，
       * 所以在「仅这次」下也照样可改，只是保存时写进时段（对整门课生效）。
       * 以前这里把它们 disabled，用户看到的就是"点不动、改不了"。
       */
      var hint2 = body.querySelector('#ebHint');
      if (hint2) {
        hint2.textContent = scope === 'once'
          ? '保存后：星期 / 节次 / 时间 / 地点 / 老师 / 本次备注只改这一天；上课周次与课程名、颜色对整门课生效。'
          : '保存后：所有没被单独调整过的周都会跟着变。';
      }
      var saveBtn = document.querySelector('#modalCard .modal-actions .btn.primary');
      if (saveBtn) { saveBtn.textContent = scope === 'once' ? '保存这一次' : '保存到所有时段'; }
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
    /**
     * 星期 / 节次 / 单双周 / 课程类型这几个下拉是**自绘**的，
     * 由下面的 fillPickers() 才插进 DOM —— 所以这里必须"用时现取"，
     * 不能在函数开头 querySelector 存成变量（那时还是 null）。
     *
     * v0.3.6c 修复："点保存没反应"就是这么来的：
     * doSave 里读 pStartSel.value 直接 TypeError，整个保存流程当场中断，
     * 用户看到的就是按钮点了没任何动静（连课程名都没改）。
     */
    function pEl(id) { return body.querySelector('#' + id); }

    // 课程类型：改完立刻把提示刷新，保存时写进 course.track
    function bindTrackHint() {
      var trackSel = pEl('ebTrack');
      if (!trackSel || trackSel.__hintBound) { return; }
      trackSel.__hintBound = true;
      trackSel.addEventListener('change', function () {
        var hint = body.querySelector('#ebTrackHint');
        var auto = AR.Palette ? AR.Palette.trackLabel(AR.Palette.inferTrack(item.course.name)) : '—';
        var picked = trackSel.value ? AR.Palette.trackLabel(trackSel.value) : '自动识别（' + auto + '）';
        if (hint) { hint.textContent = '当前识别为：' + picked + '；保存后按这个类型参与配色'; }
        AR.Bridge.haptic('light', trackSel);
      });
    }

    // 节次改了 → 时间跟着换（用户再手改时间就会留下"这门课单独的时间"）
    function syncTimes() {
      var ps = pEl('ebPStart'), pe = pEl('ebPEnd');
      var s = periodDefault(ps ? ps.value : '', 'start');
      var e = periodDefault(pe ? pe.value : '', 'end');
      var sIn = body.querySelector('#ebStart'), eIn = body.querySelector('#ebEnd');
      if (s && sIn) { sIn.value = s; }
      if (e && eIn) { eIn.value = e; }
    }
    function bindPeriodSync() {
      var ps = pEl('ebPStart'), pe = pEl('ebPEnd');
      if (ps && !ps.__syncBound) { ps.__syncBound = true; ps.addEventListener('change', syncTimes); }
      if (pe && !pe.__syncBound) { pe.__syncBound = true; pe.addEventListener('change', syncTimes); }
    }

    function doSave(close) {
      var nameInput = body.querySelector('#ebName');
      var name = (nameInput.value || '').trim();
      if (!name) { toast('课程名不能为空'); nameInput.focus(); return; }
      var tNames = splitTeacherNames(body.querySelector('#ebTeachers').value);
      var placeRaw = (body.querySelector('#ebPlace').value || '').trim();
      var wdEl = pEl('ebWeekday'), psEl = pEl('ebPStart'), peEl = pEl('ebPEnd');
      var weekday = Number(wdEl ? wdEl.value : 0) || block.weekday || 1;
      var pStart = Number(psEl && psEl.value) || startPeriod;
      var pEnd = Number(peEl && peEl.value) || pStart;
      if (pEnd < pStart) { var tmp = pStart; pStart = pEnd; pEnd = tmp; }
      var startT = (body.querySelector('#ebStart').value || '').trim();
      var endT = (body.querySelector('#ebEnd').value || '').trim();
      var note = body.querySelector('#ebNote').value || '';
      var noteCourseEl = body.querySelector('#ebNoteCourse');
      var noteCourse = noteCourseEl ? (noteCourseEl.value || '') : (course.note || '');
      var modeEl = pEl('ebWeekMode');
      var modeSel = (modeEl && modeEl.value) || 'all';
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
      /**
       * 周次永远写时段（整门课生效）：它在「仅这次」下也有意义 ——
       * "这门课从这周开始改单周"这类调整，用户要的就是能改到。
       */
      var wk = { weekMode: 'all', weeks: [] };
      {
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

      /**
       * 日期锚点（v0.3.8a）：这次编辑最终落在哪一天。
       * 换了星期就是调课，"这一次"跟着搬到新日期 —— 备注、取消都要锚到
       * 落地日（targetKey）上，挂在旧日期会没人认领（调完课备注就丢了）。
       */
      var origKey = U.dateKey(day);
      var moved = weekday !== U.weekdayOf(day);
      var targetKey = moved ? U.dateKey(U.addDays(U.mondayOf(day), weekday - 1)) : origKey;
      // 补课 / 加课只活在自己的单次记录里：改期只是把记录挪走，
      // 不能转成 move，也不能在来源日写 cancel（那会误伤模板上真正的课）
      var oneOff = (item.kind === 'makeup' || item.kind === 'add');

      if (scope === 'once') {
        var patch = {
          newPeriodStart: pStart, newPeriodEnd: pEnd,
          newStartTime: customStart, newEndTime: customEnd,
          newLocationIds: loc ? [loc.id] : [], newLocationCleared: !loc,
          newTeacherIds: tIds
        };
        if (moved && !oneOff) {
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
          AR.Store.upsertOverride(block.id, targetCourse.id, targetKey, patch);
        }
        /**
         * 原来那天不能再显示这门课 —— 补一条 cancel（v0.3.8a）。
         *
         * 以前只有"点开的是普通模板课"才补 cancel；点开的是已有单次记录时走的是
         * removeOverride(item.override.id)：把**刚改好的那条记录**删了 ——
         * 改完保存这节课直接消失；而且来源日没有 cancel，模板课又冒了回来。
         * 现在改成：只要是"模板本来就会在那天出现"的（normal / edit / time / room / move），
         * 来源日统一补 cancel。moved-in 的来源日本来就不在模板上（记录一搬走自然消失）；
         * 补课 / 加课（oneOff）没有模板可言，写 cancel 反而会误伤模板上的真课，不写。
         */
        if (moved && !oneOff && item.kind !== 'moved-in') {
          AR.Store.upsertOverride(block.id, targetCourse.id, origKey, { type: 'cancel', newDate: null });
        }
      } else {
        var up = AR.Store.updateBlock(block.id, {
          weekday: weekday, periodStart: pStart, periodEnd: pEnd,
          startTime: customStart, endTime: customEnd,
          weekMode: wk.weekMode, weeks: wk.weeks,
          locationIds: loc ? [loc.id] : [], teacherIds: tIds
        });
        if (up && up.ok === false) { toast(up.message || '保存失败'); return; }
      }

      /**
       * 备注永远是两层的（v0.3.4 起）：本次 → 单次记录；本课 → 课程记录。
       * 不管上面选的是哪个作用域，备注都按这两层各写一份，
       * 本次备注里的每一行照旧同步成作业条目（保留已划掉的状态）。
       *
       * v0.3.8a 三处修正：
       * 1) 挂到 targetKey（这次课最终落地的那天）—— 以前挂在旧日期，调课即丢；
       * 2) 只在真的写了备注、或那天已有单次记录（要把旧备注清掉）时才落记录 ——
       *    以前无条件 upsert，什么都没改的保存也会造出一条 type:'edit' 的幽灵记录：
       *    界面凭空多一个「单次调整」标记，而且这一天从此不再跟「保存所有时段」走；
       * 3) 一律用合并后的 targetCourse.id —— 改名撞名合并后 course.id 已是死 id，
       *    用它写的备注 / 作业同步全都落空（改个名备注就没了）。
       */
      var noteDate = targetKey;
      var noteRec = null;
      var ovsNow = AR.Store.overridesOfBlock(block.id);
      for (var oi = 0; oi < ovsNow.length; oi++) {
        if (ovsNow[oi].date === noteDate) { noteRec = ovsNow[oi]; break; }
      }
      if (note || noteRec) {
        AR.Store.upsertOverride(block.id, targetCourse.id, noteDate, { newNote: note, newNoteCleared: !note });
      }
      // 周次/单双周在两种作用域下都写时段（整门课生效）
      if (scope === 'once' && realBlock) {
        AR.Store.updateBlock(realBlock.id, { weekMode: wk.weekMode, weeks: wk.weeks });
      }
      var courseRec = AR.Store.courseById(targetCourse.id) || targetCourse;
      courseRec.note = noteCourse;
      courseRec.updatedAt = new Date().toISOString();
      item.note = note;
      item.courseNote = noteCourse;
      if (AR.Store.syncTasksFor) { AR.Store.syncTasksFor(block.id, targetCourse.id, noteDate, note); }

      AR.Store.save(true);
      AR.Bridge.haptic('medium', $('modalCard'));
      close();
      renderToday();
      if (currentView === 'week') { renderWeek(); }
      toast('已保存：' + name);
    }

    /**
     * 把 5 个下拉装进各自的槽位 —— 自绘，替换原生 <select>。
     * 触发器自带 .value、也会派发 change，所以下面的 doSave 与各处监听一行都不用改。
     */
    (function fillPickers() {
      function slotOf(name) { return body.querySelector('[data-slot="' + name + '"]'); }
      var node;
      node = slotOf('weekday');
      if (node) {
        node.appendChild(pickerTrigger({
          id: 'ebWeekday', value: String(block.weekday || 1), options: weekdayOpts, title: '星期'
        }));
      }
      var periodList = periodOpts();
      node = slotOf('pstart');
      if (node) {
        node.appendChild(pickerTrigger({
          id: 'ebPStart', value: String(startPeriod), options: periodList, title: '开始节次',
          sub: '节次时间在 设置 → 课程与课表 → 节次时间 里统一改',
          onPick: function (v) {
            // 起节往后挪过止节时，把止节一起带上（省得保存时才发现反了）
            var pe = body.querySelector('#ebPEnd');
            if (pe && Number(pe.value) < Number(v)) { setPickerValue(pe, v); }
          }
        }));
      }
      node = slotOf('pend');
      if (node) {
        node.appendChild(pickerTrigger({
          id: 'ebPEnd', value: String(endPeriod), options: periodList, title: '结束节次'
        }));
      }
      node = slotOf('weekmode');
      if (node) {
        node.appendChild(pickerTrigger({
          id: 'ebWeekMode', value: weekMode, title: '单双周',
          options: [
            { v: 'all', t: '每周' }, { v: 'odd', t: '单周' },
            { v: 'even', t: '双周' }, { v: 'custom', t: '自定义' }
          ]
        }));
      }
      node = slotOf('track');
      if (node) {
        node.appendChild(pickerTrigger({
          id: 'ebTrack', value: String(item.course.track || ''), options: trackOpts,
          title: '课程类型', sub: '影响配色方案：文 / 理 / 公共 / 体育 各成一套色系'
        }));
      }
      // 下拉全部就位后再挂监听（前面那些函数是"用时现取"，这里必须放在 fillPickers 之后）
      bindPeriodSync();
      bindTrackHint();
    })();

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
        {
          label: scope === 'once' ? '保存这一次' : '保存到所有时段', kind: 'primary',
          onClick: function (close) { doSave(close); }
        },
        { label: '取消', onClick: function (close) { close(); } }
      ]
    });
    applyScope(scope);
    // 同上：节次下拉是自绘的，这里用时现取（以前写死 pStartSel，`pEl` 之外没这个变量了）
    var focusEl = opts.focus === 'time' ? body.querySelector('#ebStart')
      : (opts.focus === 'period' ? pEl('ebPStart') : null);
    if (focusEl) { try { focusEl.focus(); } catch (e) { /* 忽略：个别 WebView 不支持聚焦 select */ } }
  }

  /**
   * 课程详情（周表左侧概览 / 今日时间线点开）：
   * v0.2.0 起详细修改统一进「编辑课程」窗口，这里只做速览 + 快捷入口。
   */
  /**
   * 课程详情弹窗。
   *
   * opts.readOnly = true：只读视图 —— 只列字段 + 「关闭」。
   * 用在「本周概览」展开态的周表里：那儿点课程块只是想看一眼这节课，
   * 不该出现编辑 / 换色 / 删除这些入口（要改去「周表」页，那儿的逻辑一个字没动）。
   */
  function openCourseModal(item, opts) {
    opts = opts || {};
    var sem = AR.Store.currentSemester();
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">时间</div><div class="detail-val">' + U.WEEKDAY_NAMES[U.weekdayOf(item.date)] + ' '
      + U.escapeHtml(fmtRange(item)) + '（' + U.escapeHtml(item.periodLabel) + '）</div>'
      + '<div class="detail-key">周次</div><div class="detail-val">' + U.escapeHtml(AR.Schedule.weeksLabel(item.block, sem.weekCount)) + '</div>'
      + '<div class="detail-key">老师</div><div class="detail-val">' + U.escapeHtml(item.teachers.map(function (t) { return t.name; }).join('、') || '—') + '</div>'
      + '<div class="detail-key">地点</div><div class="detail-val">' + U.escapeHtml(item.location ? item.location.raw : '—') + '</div>'
      + '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(item.note || '—') + '</div>'
      // 本课备注只在写了的时候才占一行（没写就不显示）
      + (item.courseNote
        ? '<div class="detail-key">本课备注</div><div class="detail-val">' + U.escapeHtml(item.courseNote) + '</div>'
        : '')
      + '</div>';
    var actions = [];
    if (opts.readOnly) {
      actions.push({ label: '关闭', kind: 'primary', onClick: function (close) { close(); } });
    } else {
      body += '<div class="muted" style="margin-top:14px">课程名、星期、节次、时间、单双周、老师、地点、颜色，都能在「编辑课程」里改。</div>';
      actions.push(
        { label: '编辑课程', kind: 'primary', onClick: function (close) { close(); openBlockEditor(item); } },
        { label: '设置颜色', onClick: function () { openColorModal(item); } },
        { label: '编辑备注', onClick: function () { openNoteModal(item, 'once'); } },
        { label: '本课备注', onClick: function () { openNoteModal(item, 'course'); } },
        { label: '删除这门课', kind: 'danger', onClick: function (close) { deleteCourse(item.course.id, close); } },
        { label: '关闭', onClick: function (close) { close(); } }
      );
    }
    openModal({
      title: item.course.name,
      sub: opts.readOnly ? '课程详情 · 只读' : '课程详情',
      body: body,
      actions: actions
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
      + '<br>系统日历 / 闹钟：'
      + (leadMinutes() > 0 ? ('提前 ' + leadMinutes() + ' 分钟（' + (function () {
        var at = remindAt(startMs);
        return at ? (U.pad2(at.h) + ':' + U.pad2(at.m)) : '—';
      })() + '）') : '按上课时间')
      + '（设置 → 系统集成 可调）'
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
            var at = remindAt(startMs);
            AR.Bridge.addCalendarEvent(
              item.course.name,
              item.location ? item.location.raw : '',
              'Abbey Road 课表 · ' + item.periodLabel + (item.note ? ' · ' + item.note : ''),
              at.ms, endMs);
            AR.Bridge.haptic('medium', $('modalCard'));
          }
        },
        {
          label: '设置闹钟', onClick: function () {
            var at = remindAt(startMs || Date.now());
            AR.Bridge.setAlarm(at.h, at.m, item.course.name + ' ' + (item.location ? item.location.raw : ''));
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
   * 闹钟 / 系统日历的提前量（分钟）：设置 → 系统集成，默认 15。
   * 上课前十几分钟响，才有时间从宿舍走到教室；填 0 就还是上课时间本身。
   */
  function leadMinutes() {
    var v = S.settings.integration ? Number(S.settings.integration.earlyMinutes) : NaN;
    return (isFinite(v) && v >= 0) ? Math.round(v) : 15;
  }

  /** 上课时间(ms) → 提醒时间：提前 leadMinutes 分钟，返回 {ms,h,m}（跨零点也算得对） */
  function remindAt(ms) {
    if (ms == null) { return null; }
    var d = new Date(ms - leadMinutes() * 60000);
    return { ms: d.getTime(), h: d.getHours(), m: d.getMinutes() };
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
    /**
     * 备注永远是"这一次"的（v0.3.4 分层）：
     * 没有单次记录就现建一条 override，绝不写回时段 block ——
     * 以前写回 block，于是这次课的作业备注会在每一周都冒出来。
     */
    if (field === 'note') {
      if (item.kind === 'makeup' || item.kind === 'add') {
        // 补课 / 加课：这节课本来就只存在单次记录里
        var mo = (item.override && AR.Store.overrideById) ? AR.Store.overrideById(item.override.id) : null;
        if (mo) {
          mo.newNote = value; mo.newNoteCleared = !value;
          mo.updatedAt = new Date().toISOString();
        }
        item.note = value;
        AR.Store.save(true);
        return mo;
      }
      var ovRec = AR.Store.upsertOverride(item.blockId, item.courseId, U.dateKey(item.date),
        { newNote: value, newNoteCleared: !value });
      item.override = ovRec;
      if (item.src) { item.src.note = 'override'; }
      item.note = value;
      return ovRec;
    }
    var pick = editTargetOf(item, field);
    var ov = pick.ov;
    var target = pick.target;
    if (!target) { return null; }

    if (field === 'teacher') {
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

  /**
   * 备注模块（v0.3.4 分层）。
   *
   *   本次备注 —— 点击备注格子进来，只属于这一天（写进单次记录）；
   *              这里写下的每一行都会自动识别成作业条目。
   *   本课备注 —— 长按备注格子进来，这门课所有时段都显示。
   *
   * 两个输入框都在同一个弹窗里，进来时会把 focus 的那一栏标出来，
   * 顶部也写清楚"点 = 本次，长按 = 本课"。
   */
  function openNoteModal(item, scope) {
    var which = scope === 'course' ? 'course' : 'once';
    var dateLabel = (item.date.getMonth() + 1) + '/' + item.date.getDate();
    var hw = AR.Store.homeworkSettings ? AR.Store.homeworkSettings() : { on: true, mode: 'line' };
    var body = el('<div>'
      + '<div class="field note-once' + (which === 'once' ? ' focus' : '') + '">'
      + '<label class="field-label">本次备注 · 只改 ' + dateLabel + ' 这一次</label>'
      + '<textarea class="input" id="noteEditInput" rows="4" placeholder="一行一条，例如：&#10;作业：习题 3-5&#10;复习第四章">'
      + U.escapeHtml(item.note || '') + '</textarea>'
      + (hw.on ? '<p class="muted" style="margin:6px 0 0">每一行会自动变成今日页的一条作业（设置里可改判定方式）。</p>' : '')
      + '</div>'
      + '<div class="field note-course' + (which === 'course' ? ' focus' : '') + '" style="margin-top:12px">'
      + '<label class="field-label">本课备注 · 这门课所有时段</label>'
      + '<textarea class="input" id="noteCourseInput" rows="3" placeholder="例如：每次都要带计算器">'
      + U.escapeHtml(item.courseNote || '') + '</textarea>'
      + '</div></div>');
    openModal({
      title: '备注',
      sub: item.course.name + ' · ' + (which === 'once' ? ('本次（' + dateLabel + '）') : '本课（所有时段）'),
      body: body,
      actions: [
        {
          label: '复制本次', onClick: function () {
            AR.Bridge.copy(($('noteEditInput') && $('noteEditInput').value) || item.note || '');
          }
        },
        {
          label: '保存', kind: 'primary', onClick: function (close) {
            var onceEl = $('noteEditInput');
            var courseEl = $('noteCourseInput');
            var vOnce = onceEl ? onceEl.value : (item.note || '');
            var vCourse = courseEl ? courseEl.value : (item.courseNote || '');
            if (!writeItemField(item, 'note', vOnce)) { toast('没找到这节课的记录，保存失败'); return; }
            item.note = vOnce;
            // 本课备注写在 course 上（改名 / 换色之外的字段不会影响其它时段）
            var courseRec = AR.Store.courseById(item.courseId);
            if (courseRec) {
              courseRec.note = vCourse;
              courseRec.updatedAt = new Date().toISOString();
              item.course.note = vCourse;
            }
            item.courseNote = vCourse;
            // 本次备注 → 作业条目（保留已划掉的状态）
            if (AR.Store.syncTasksFor) { AR.Store.syncTasksFor(item.blockId, item.courseId, U.dateKey(item.date), vOnce); }
            AR.Store.save(true);
            close();
            AR.Bridge.haptic('medium', $('zoneNext'));
            refreshAfterItemEdit();
            toast(vOnce || vCourse ? '备注已保存' : '备注已清空');
          }
        }
      ]
    });
    var focusEl = $(which === 'course' ? 'noteCourseInput' : 'noteEditInput');
    if (focusEl) { setTimeout(function () { focusEl.focus(); }, 60); }
  }

  /** 改完某一节课的字段后统一刷新（今日 / 周表 / 最近的课都跟着变） */
  function refreshAfterItemEdit() {
    renderToday();
    if (currentView === 'week') { renderWeek(); }
  }

  /* ══════════════════════════════════════════════════════════════
     作业模块（v0.3.4）

     数据来自「本次备注」里识别出来的条目（AR.Store.taskBoard），
     出现两处：
       · 今日日程卡片最下面 —— 一条汇总，点开就地展开成列表；
       · 最近的课卡片 —— 当天所有课结束之后，直接铺开条目。
     划掉：左右滑都行（不用点圆圈）。滑出去用 AR.Motion 弹窗退场的
     时长 / 曲线 / 姿势，落进列表底部的「已完成」区。
     ══════════════════════════════════════════════════════════════ */

  var hwOpen = false;        // 今日日程里那条汇总是否展开
  var hwDoneOpen = false;    // 「已完成」区是否展开
  var hwEarlierOpen = false; // 「更早的已完成」是否展开

  /**
   * 「已完成」区自动收起的时机（用户定：划掉后立刻收起 + 切日期重置）：
   *   · 每划掉一条 / 找回一条之后 —— 收到收起状态，不自动弹开；
   *   · 切换日期、进出今日页 —— 一并重置，免得"点开过一次就永远开着"。
   */
  function collapseDoneGroups() {
    hwDoneOpen = false;
    hwEarlierOpen = false;
  }

  function hwShortDate(key) {
    var d = U.parseDateKey(key);
    return d ? ((d.getMonth() + 1) + '/' + d.getDate()) : '';
  }

  /** 作业条目：左滑或右滑都能划掉 */
  function hwRow(task) {
    var todayK = U.dateKey(new Date());
    var dateTag = (task.date && task.date !== todayK)
      ? '<span class="hw-date">' + hwShortDate(task.date) + '</span>' : '';
    var node = el('<div class="hw-row" data-id="' + task.id + '">'
      + dateTag
      + '<span class="hw-text">' + U.escapeHtml(task.text) + '</span>'
      + '<span class="hw-swipe-hint">划掉</span></div>');
    // 横向手势归自己，纵向留给卡片滚动
    node.style.touchAction = 'pan-y';
    var x0 = 0, y0 = 0, dx = 0, armed = false, horizontal = false, raf = 0;
    var MAX = 140;                      // 最多拖这么远，再拉就有"橡皮筋"的感觉
    function paint() {
      raf = 0;
      node.style.transform = 'translate3d(' + dx + 'px,0,0)';
      node.classList.toggle('swipe-ok', Math.abs(dx) >= 64);
    }
    function reset() {
      armed = false; horizontal = false; dx = 0;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      node.classList.remove('swiping', 'swipe-ok');
      node.style.transform = '';
    }
    node.addEventListener('pointerdown', function (ev) {
      if (ev.button) { return; }
      armed = true; horizontal = false; dx = 0;
      x0 = ev.clientX; y0 = ev.clientY;
      node.classList.add('swiping');
      if (node.setPointerCapture) { try { node.setPointerCapture(ev.pointerId); } catch (e) { } }
    });
    node.addEventListener('pointermove', function (ev) {
      if (!armed) { return; }
      dx = ev.clientX - x0;
      var dy = ev.clientY - y0;
      if (!horizontal) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { return; }
        // 纵向占优就交还给卡片滚动；横向要明显占优才算划卡片
        if (Math.abs(dy) > Math.abs(dx) * 1.2) { reset(); return; }
        horizontal = true;
      }
      // 跟手：每帧只写一次 transform，超出上限就慢慢"拉紧"
      if (Math.abs(dx) > MAX) { dx = (dx > 0 ? 1 : -1) * (MAX + (Math.abs(dx) - MAX) * 0.25); }
      if (!raf) { raf = requestAnimationFrame(paint); }
    });
    function finish() {
      if (!armed && !horizontal) { return; }
      var hit = horizontal && Math.abs(dx) >= 64;
      if (!hit) {
        // 没划够：滑回原位（同样走统一曲线）
        if (node.style.transform) {
          node.animate(
            [{ transform: 'translate3d(' + dx + 'px,0,0)' }, { transform: 'none' }],
            { duration: 180, easing: AR.Motion ? AR.Motion.ease('soft') : 'cubic-bezier(.4,0,.2,1)', fill: 'none' }
          );
        }
        reset();
        return;
      }
      var dir = dx > 0 ? 1 : -1;
      var from = dx;                    // 从手指松开的位置接着飞，不回弹
      armed = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      flyOutTask(node, dir, from, function () {
        AR.Store.setTaskDone(task.id, true);
        AR.Bridge.haptic('medium', node);
        toast('已完成 · 可在「已完成」里找回');
        collapseDoneGroups();          // 划掉之后「已完成」区不自动弹开
        refreshHomework();
      });
    }
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', reset);
    return node;
  }

  /**
   * 划掉的退场动画：姿势 / 时长 / 曲线都取自 AR.Motion 的弹窗场景（out），
   * 所以"划出去"和"弹窗关掉"是同一种手感，不会各走一套。
   */
  function flyOutTask(node, dir, fromX, after) {
    var m = AR.Motion ? AR.Motion.dir('modal', 'out') : null;
    var dur = m ? Math.round((m.dur || 260) / motionSpeed()) : 260;
    var ease = AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.4,0,.2,1)';
    var to = AR.Motion ? AR.Motion.pose({ o: 0, x: dir * 56, s: .96 }) : { opacity: 0, transform: 'translateX(' + dir * 56 + 'px)' };
    var start = { opacity: 1, transform: 'translate3d(' + (fromX || 0) + 'px,0,0)', filter: 'none' };
    node.style.transform = '';
    if (!node.animate) { after(); return; }
    var anim = node.animate([start, to], { duration: dur, easing: ease, fill: 'forwards' });
    anim.onfinish = function () { after(); };
  }

  /**
   * 已完成的一条：**长按 600ms** 才能"找回"（恢复成未完成）。
   * 单击什么都不做 —— 避免手滑把刚划掉的又点回来。
   * 长按过程中条目底部有一条进度线（统一曲线，600ms 走满）。
   */
  function hwDoneRow(task) {
    var doneDay = AR.Store.taskDoneDay ? AR.Store.taskDoneDay(task) : (task.doneAt ? String(task.doneAt).slice(0, 10) : task.date);
    var node = el('<div class="hw-row done" data-id="' + task.id + '">'
      + '<span class="hw-tick">✓</span>'
      + '<span class="hw-text">' + U.escapeHtml(task.text) + '</span>'
      + '<span class="hw-when">' + hwShortDate(doneDay || task.date) + '</span>'
      + '<span class="hw-hold">长按找回</span></div>');
    bindLongPress(node, function () {
      AR.Store.setTaskDone(task.id, false);
      AR.Bridge.haptic('medium', node);
      toast('已找回：「' + task.text + '」');
      collapseDoneGroups();
      refreshHomework();
    }, 600);
    node.addEventListener('click', function () {
      // 单击只做一次很轻的反馈，不找回（找回要长按）
      if (node.__lpFired) { node.__lpFired = false; return; }
      AR.Bridge.haptic('light', node);
    });
    return node;
  }

  /** 作业列表（未完成 + 已完成区） */
  /* ── 作业 · 按课程分组（v0.3.7）─────────────────────────────
     设置里可关。分组只作用于「未完成」那一段：
     已完成 / 更早的已完成仍然是一条折叠头，不再套一层组，免得层级太深。 */

  /** 把未完成条目按课程归类：顺序跟「课程与课表」里的课程顺序一致 */
  function hwGroups(tasks) {
    var st = AR.Store.get();
    var courses = st.courses || [];
    var order = {}, names = {}, colors = {};
    for (var i = 0; i < courses.length; i++) {
      order[courses[i].id] = i;
      names[courses[i].id] = courses[i].name;
      colors[courses[i].id] = courses[i].colorKey;
    }
    var map = {}, out = [];
    for (var j = 0; j < tasks.length; j++) {
      var t = tasks[j];
      var key = (t.courseId && names[t.courseId]) ? t.courseId : '';
      if (!map[key]) {
        map[key] = {
          key: key,
          name: key ? names[key] : '未分类',
          color: key ? U.colorHex(colors[key]) : '',
          items: []
        };
        out.push(map[key]);
      }
      map[key].items.push(t);
    }
    // 未分类永远排最后
    out.sort(function (a, b) {
      if (!a.key) { return 1; }
      if (!b.key) { return -1; }
      return (order[a.key] == null ? 999 : order[a.key]) - (order[b.key] == null ? 999 : order[b.key]);
    });
    return out;
  }

  /** 组头：课程色点 + 课程名 + 条数 */
  function hwGroupHead(g) {
    var dot = g.color ? '<span class="hw-dot" style="background:' + U.escapeHtml(g.color) + '"></span>' : '';
    return el('<div class="hw-group">' + dot
      + '<span class="hw-group-name">' + U.escapeHtml(g.name || '未分类') + '</span>'
      + '<span class="hw-group-n">' + g.items.length + '</span></div>');
  }

  /** 作业列表（未完成 + 已完成区） */
  function hwListBox(board) {
    var box = el('<div class="hw-list"></div>');
    var hwSet = AR.Store.homeworkSettings ? AR.Store.homeworkSettings() : { groupByCourse: false };
    if (board.open.length) {
      if (hwSet.groupByCourse) {
        var groups = hwGroups(board.open);
        for (var gi = 0; gi < groups.length; gi++) {
          box.appendChild(hwGroupHead(groups[gi]));
          for (var gj = 0; gj < groups[gi].items.length; gj++) {
            box.appendChild(hwRow(groups[gi].items[gj]));
          }
        }
      } else {
        for (var i = 0; i < board.open.length; i++) { box.appendChild(hwRow(board.open[i])); }
      }
    } else {
      box.appendChild(el('<div class="hw-empty muted">都划完了，今天没有待办作业 ✓</div>'));
    }
    var doneWeek = board.doneWeek || [];
    var doneAll = board.done.length + doneWeek.length;
    if (doneAll) {
      var head = el('<button class="hw-done-head' + (hwDoneOpen ? ' open' : '') + '" type="button">已完成 ' + board.done.length
        + (doneWeek.length ? ' · 更早 ' + doneWeek.length : '')
        + '<span class="hw-done-hint">点开可找回</span>'
        + '<span class="hw-chev">▸</span></button>');
      var dn = el('<div class="hw-done"></div>');
      dn.hidden = !hwDoneOpen;
      for (var d = 0; d < board.done.length; d++) { dn.appendChild(hwDoneRow(board.done[d])); }
      /**
       * 昨天到一周前划掉的：折在「更早的已完成」里，默认收起（点开还能找回）；
       * 超过一周的干脆不显示 —— 数据还在文件里，只是不再占界面。
       */
      if (doneWeek.length) {
        var more = el('<button class="hw-more' + (hwEarlierOpen ? ' open' : '') + '" type="button">'
          + '<span class="hw-chev">▸</span>'
          + '<span class="hw-more-t">' + (hwEarlierOpen ? '收起更早的' : '更早的已完成（' + doneWeek.length + '）') + '</span></button>');
        var moreBox = el('<div class="hw-earlier"></div>');
        moreBox.hidden = !hwEarlierOpen;
        for (var e = 0; e < doneWeek.length; e++) { moreBox.appendChild(hwDoneRow(doneWeek[e])); }
        more.addEventListener('click', function () {
          hwEarlierOpen = !hwEarlierOpen;
          toggleHwBox(moreBox, hwEarlierOpen);
          more.classList.toggle('open', hwEarlierOpen);
          more.querySelector('.hw-more-t').textContent = hwEarlierOpen ? '收起更早的' : '更早的已完成（' + doneWeek.length + '）';
        });
        dn.appendChild(more);
        dn.appendChild(moreBox);
      }
      head.addEventListener('click', function () {
        hwDoneOpen = !hwDoneOpen;
        toggleHwBox(dn, hwDoneOpen);
        head.classList.toggle('open', hwDoneOpen);
        AR.Bridge.haptic('light', head);
      });
      box.appendChild(head);
      box.appendChild(dn);
    }
    return box;
  }

  /** 展开：姿势 / 曲线走统一动画接口（contentIn），条目再用 listIn 逐条淡入 */
  function playHwExpand(node) {
    if (!node || !node.animate) { return; }
    var m = AR.Motion ? AR.Motion.get('contentIn') : null;
    var dur = m ? Math.round((m.dur || 300) / motionSpeed()) : 300;
    node.animate(
      [{ opacity: 0, transform: 'translate3d(0,' + ((m && m.y) || 6) + 'px,0)' }, { opacity: 1, transform: 'none' }],
      { duration: dur, easing: AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.16,1,.3,1)', fill: 'none' }
    );
    fadeInList(node, '.hw-row');
  }

  /**
   * 作业面板的展开 / 收起。
   *
   * 以前只切换 `hidden`，容器高度是**瞬间跳**的 —— 用户看到的就是"展开太弹"。
   * 现在高度也按统一曲线补间（时长/曲线来自 AR.Motion 的 contentIn），
   * 内容再叠一层 contentIn + listIn 的逐条淡入。
   */
  function toggleHwBox(box, open) {
    if (!box) { return; }
    if (box.__hAnim) { try { box.__hAnim.cancel(); } catch (e) { } box.__hAnim = null; }
    if (box.__foldTimer) { clearTimeout(box.__foldTimer); box.__foldTimer = 0; }
    /**
     * 展开状态只认节点上的 data-open，**动画收尾和兜底定时器也读它**。
     * 老实现有两个坑：
     *   ① 兜底定时器把"那一次点击的 open"捕进闭包 —— 快速连点时，旧定时器会在
     *      新动画结束之后才醒，然后用旧值收尾，把刚折叠的列表又展开回去
     *      （用户看到的"折一次之后就折不动了"）；
     *   ② 只靠 hidden 收尾 —— `.hw-done { display:flex }` 会盖掉 [hidden] 的
     *      display:none，等于压根没折叠（现在有全局 [hidden] 规则兜底）。
     */
    box.dataset.open = open ? '1' : '0';
    if (!box.animate) { finishFold(box); return; }
    var m = AR.Motion ? AR.Motion.get('contentIn') : null;
    if (m && !m.dur) { finishFold(box); return; }
    var dur = Math.round(((m && m.dur) || 300) / motionSpeed());
    var ease = AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.16,1,.3,1)';
    var from = box.hidden ? 0 : Math.round(box.getBoundingClientRect().height);
    box.hidden = false;
    box.style.overflow = 'hidden';
    box.style.height = from + 'px';        // 先钉在起始高度，避免"起点是 auto"导致的跳变
    var to = open ? Math.round(box.scrollHeight) : 0;
    if (open) { playHwExpand(box); box.__reveal = true; }
    var anim = box.animate(
      [{ height: from + 'px' }, { height: to + 'px' }],
      { duration: dur, easing: ease, fill: 'forwards' }
    );
    box.__hAnim = anim;
    anim.onfinish = function () {
      if (box.__hAnim !== anim) { return; }   // 已被更晚的那次点击接管，别抢着收尾
      /**
       * v0.3.7 修复"能展开但滑不到"：
       * fill:'forwards' 的动画**播完之后仍然在生效**，会把容器高度永久钉在
       * "展开那一刻量到的值"。于是后展开的「已完成」比外层还高 →
       * 被 .hw-card 的 overflow:hidden 裁掉，外层滚动区的 scrollHeight 也不涨，
       * 表现就是"列表出来了，可怎么都滚不到"。
       * 所以收尾时必须 cancel 掉这条动画（cancel 之后它不再提供样式），
       * 容器回到 auto 高度，卡片和滚动区才会跟着长高。
       */
      dropFoldAnim(box);
      finishFold(box);
    };
    // 兜底：动画被打断（元素被换掉 / 页面切走）时也要落地，不能卡在半路
    box.__foldTimer = setTimeout(function () {
      box.__foldTimer = 0;
      if (!box.__hAnim) { finishFold(box); }
    }, dur + 420);
  }

  /** 卸掉折叠动画：一定要 cancel —— 光清内联 height 是没用的，动画还在给高度供值 */
  function dropFoldAnim(box) {
    var a = box && box.__hAnim;
    if (box) { box.__hAnim = null; }
    if (a && a.cancel) { try { a.cancel(); } catch (e) { /* 已经卸掉了 */ } }
  }

  /**
   * 展开之后，如果新露出来的内容被挡在滚动区下面，就轻轻滚进来。
   * 只在"真的超出"时才动，并且走 scrollTo 的平滑过渡（不硬跳）。
   */
  function revealInScroll(node) {
    if (!node || !node.getBoundingClientRect) { return; }
    var host = node.closest ? node.closest('.scroll') : null;
    if (!host) { return; }
    var over = node.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom;
    if (over <= 6) { return; }
    var top = host.scrollTop + over + 10;
    try {
      if (host.scrollTo) { host.scrollTo({ top: top, behavior: 'smooth' }); }
      else { host.scrollTop = top; }
    } catch (e) { host.scrollTop = top; }
  }

  /** 收尾：清掉内联尺寸，按**当前** data-open 决定隐藏还是展开（不读闭包里的旧值） */
  function finishFold(box) {
    if (!box) { return; }
    dropFoldAnim(box);
    box.style.overflow = '';
    box.style.height = '';
    box.hidden = box.dataset.open !== '1';
    if (box.dataset.open === '1' && box.__reveal) {
      box.__reveal = false;
      setTimeout(function () { revealInScroll(box); }, 30);
    }
  }

  function hwVisibleInNext() {
    var sem = AR.Store.currentSemester();
    var items = AR.Schedule.dayItems(new Date(), sem);
    if (!items.length) { return true; }                     // 今天没课也照常显示作业
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var first = items[0], last = items[items.length - 1];
    var startMin = first.startMin != null ? first.startMin : null;
    var endMin = last.endMin != null ? last.endMin : null;
    if (endMin == null) { return true; }
    /**
     * "今天的课都上完了" = 晚于最后一节下课，或者**还没到第一节上课**
     * （凌晨看今日页时，昨天那份作业当然要继续挂着）。
     */
    if (startMin != null && nowMin < startMin) { return true; }
    return nowMin >= endMin;
  }

  /** 未完成作业条数（窄栏摘要里也报一句，免得被压成一条摘要就看不见作业了） */
  function hwOpenCount() {
    if (!AR.Store.homeworkSettings || !AR.Store.homeworkSettings().on) { return 0; }
    var b = AR.Store.taskBoard(U.dateKey(new Date()));
    return b.open.length;
  }

  /** 作业卡片要不要出现：作业功能开着，或者有"要在今日页显示"的长期任务 */
  function hwZoneVisible() {
    if (AR.Store.homeworkSettings && AR.Store.homeworkSettings().on) { return true; }
    return !!(AR.Store.longTaskTodayList && AR.Store.longTaskTodayList().length);
  }

  /** 改完长期任务 / 作业设置后：设置页那份清单 + 今日页的面板一起刷新 */
  function refreshHomeworkPanels() {
    if (AR.Panels && AR.Panels.renderLongTaskList) { AR.Panels.renderLongTaskList(); }
    refreshHomework();
  }

  /* ── 长期任务（v0.3.7）──────────────────────────────────────
     志愿时长、阅读量这种"攒进度"的目标：和作业同屏显示，
     但**单独一节、单独统计**，作业的条数 / 完成率里不会混进它们。 */

  function ltNum(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return String(v);
  }

  /** 今日页里的「长期任务」小节（没有任何要显示的项时返回 null） */
  function longTaskNode() {
    var list = AR.Store.longTaskTodayList ? AR.Store.longTaskTodayList() : [];
    if (!list.length) { return null; }
    var box = el('<div class="lt-block"></div>');
    box.appendChild(el('<div class="lt-head"><span class="lt-ico">◔</span>'
      + '<span class="lt-t">长期任务</span>'
      + '<span class="lt-n">' + list.length + ' 项</span></div>'));
    var todayK = U.dateKey(new Date());
    for (var i = 0; i < list.length; i++) { box.appendChild(longTaskRow(list[i], todayK)); }
    return box;
  }

  /** 一条长期任务：色点 + 名称 + 进度条 + 累计/目标（今日有进度就补一句） */
  function longTaskRow(t, todayK) {
    var s = AR.Store.longTaskStats(t, todayK);
    var color = U.colorHex(t.colorKey || '#5B8DEF');
    var node = el('<button class="lt-row' + (s.done ? ' done' : '') + '" type="button">'
      + '<span class="lt-dot" style="background:' + U.escapeHtml(color) + '"></span>'
      + '<span class="lt-main">'
      + '<span class="lt-name">' + U.escapeHtml(t.name || '未命名') + '</span>'
      + '<span class="lt-bar"><i style="width:' + Math.round(s.rate * 100) + '%;background:'
      + U.escapeHtml(color) + '"></i></span>'
      + '</span>'
      + '<span class="lt-val">' + ltNum(s.total) + ' / ' + ltNum(s.target)
      + ' <em>' + U.escapeHtml(t.unit || '') + '</em>'
      + (s.today ? '<span class="lt-today">今日 +' + ltNum(s.today) + '</span>' : '')
      + '</span></button>');
    node.addEventListener('click', function (ev) {
      ev.stopPropagation();
      openLongTaskEntry(t);
    });
    return node;
  }

  /**
   * 长期任务 · 记一笔。
   * 上面是进度（累计 / 今日 / 近 7 天 / 完成率），中间是常用数量的快捷按钮，
   * 下面填数量 + 备注；最近几笔列出来，点 ✕ 可以撤销记错的那一笔。
   * 快捷按钮点完直接重新打开这个窗口 —— 进度立刻刷新，不用关掉再点一次。
   */
  function openLongTaskEntry(t) {
    var cur = (AR.Store.longTaskById && AR.Store.longTaskById(t.id)) || t;
    var todayK = U.dateKey(new Date());
    var s = AR.Store.longTaskStats(cur, todayK);
    var unit = cur.unit || '';
    var color = U.colorHex(cur.colorKey || '#5B8DEF');
    var body = el('<div class="lt-sheet">'
      + '<div class="lt-top">'
      + '<div class="lt-top-name">' + U.escapeHtml(cur.name || '未命名') + '</div>'
      + '<div class="lt-top-val"><b>' + ltNum(s.total) + '</b>'
      + '<span class="muted"> / ' + ltNum(s.target) + ' ' + U.escapeHtml(unit) + '</span></div>'
      + '<div class="lt-bar big"><i style="width:' + Math.round(s.rate * 100) + '%;background:'
      + U.escapeHtml(color) + '"></i></div>'
      + '<div class="lt-top-sub">今日 +' + ltNum(s.today) + ' · 近 7 天 +' + ltNum(s.week)
      + ' · 完成率 ' + s.percent + '%</div>'
      + '</div>'
      + '<div class="lt-quick" id="ltQuick"></div>'
      + '<div class="field"><label class="field-label">数量（' + U.escapeHtml(unit) + '）</label>'
      + '<input class="input" id="ltAmount" type="number" inputmode="decimal" step="0.5" value="1"></div>'
      + '<div class="field"><label class="field-label">备注（可不填）</label>'
      + '<input class="input" id="ltNote" placeholder="例如：社区志愿服务中心"></div>'
      + '<div class="lt-recent" id="ltRecent"></div></div>');

    var quick = body.querySelector('#ltQuick');
    var quicks = [1, 2, 5, -1];
    for (var q = 0; q < quicks.length; q++) {
      (function (amt) {
        var b = el('<button class="chip-btn" type="button">' + (amt > 0 ? '+' : '') + ltNum(amt) + '</button>');
        b.addEventListener('click', function () {
          if (!AR.Store.longTaskAddEntry(cur.id, amt, '')) { toast('记不了这一笔'); return; }
          AR.Bridge.haptic('light', b);
          toast((amt > 0 ? '已记 +' : '已记 ') + ltNum(amt) + (unit ? ' ' + unit : ''));
          openLongTaskEntry(cur);
        });
        quick.appendChild(b);
      })(quicks[q]);
    }

    var recents = AR.Store.longTaskRecentEntries(cur, 6);
    var rbox = body.querySelector('#ltRecent');
    if (recents.length) {
      rbox.appendChild(el('<div class="lt-recent-title">最近记录 · 点 ✕ 可撤销</div>'));
      for (var r = 0; r < recents.length; r++) {
        (function (e) {
          var day = AR.Store.longTaskEntryDay(e);
          var d = day ? U.parseDateKey(day) : null;
          var label = d ? ((d.getMonth() + 1) + '/' + d.getDate()) : '';
          var row = el('<div class="lt-recent-row">'
            + '<span class="lt-recent-amt">' + ltNum(e.amount) + '</span>'
            + '<span class="lt-recent-day">' + label + '</span>'
            + '<span class="lt-recent-note">' + U.escapeHtml(e.note || '') + '</span>'
            + '<button class="lt-del" type="button" title="删掉这一笔">✕</button></div>');
          row.querySelector('.lt-del').addEventListener('click', function () {
            AR.Store.longTaskRemoveEntry(cur.id, e.id);
            AR.Bridge.haptic('warn', row);
            toast('已撤销这一笔');
            openLongTaskEntry(cur);
          });
          rbox.appendChild(row);
        })(recents[r]);
      }
    }

    openModal({
      title: '记一笔',
      sub: (cur.name || '') + ' · ' + ltNum(s.total) + ' / ' + ltNum(s.target) + (unit ? ' ' + unit : ''),
      body: body,
      actions: [
        {
          label: '编辑目标', onClick: function (close) { close(); openLongTaskEdit(cur); }
        },
        {
          label: '保存', kind: 'primary', onClick: function (close) {
            var amt = Number((body.querySelector('#ltAmount') || {}).value);
            if (!isFinite(amt) || !amt) { toast('请填一个不为 0 的数量'); return; }
            var note = (body.querySelector('#ltNote') || {}).value || '';
            AR.Store.longTaskAddEntry(cur.id, amt, note);
            AR.Bridge.haptic('medium', $('modalCard'));
            close();
            refreshHomework();
            toast('已记 ' + (amt > 0 ? '+' : '') + ltNum(amt) + (unit ? ' ' + unit : ''));
          }
        },
        { label: '取消', onClick: function (close) { close(); } }
      ]
    });
    var amtEl = body.querySelector('#ltAmount');
    if (amtEl) { setTimeout(function () { try { amtEl.focus(); amtEl.select(); } catch (e) { } }, 60); }
  }

  /** 长期任务 · 新建 / 编辑（设置页里点「＋ 新建」或点某一条） */
  function openLongTaskEdit(t) {
    var isNew = !t;
    var cur = t || { name: '', unit: '小时', target: 20, colorKey: 'blue', showInToday: true };
    var picked = cur.colorKey || 'blue';
    var swatchHtml = '';
    for (var i = 0; i < U.PALETTE.length; i++) {
      swatchHtml += '<button type="button" class="swatch' + (U.PALETTE[i].key === picked ? ' active' : '')
        + '" data-color="' + U.PALETTE[i].key + '" title="' + U.PALETTE[i].name
        + '" style="background:' + U.PALETTE[i].hex + '"></button>';
    }
    var body = el('<div class="lt-edit">'
      + '<div class="field"><label class="field-label">名称</label>'
      + '<input class="input" id="ltName" placeholder="例如：志愿时长" value="'
      + U.escapeHtml(cur.name || '') + '"></div>'
      + '<div class="field"><label class="field-label">单位</label>'
      + '<input class="input" id="ltUnit" placeholder="小时 / 次 / 篇 / 公里" value="'
      + U.escapeHtml(cur.unit || '') + '"></div>'
      + '<div class="field"><label class="field-label">目标值</label>'
      + '<input class="input" id="ltTarget" type="number" inputmode="decimal" min="0" step="1" value="'
      + ltNum(cur.target || 0) + '"></div>'
      + '<div class="field"><label class="field-label">颜色</label>'
      + '<div class="swatches" id="ltColors">' + swatchHtml + '</div></div>'
      + '<label class="lt-check"><input type="checkbox" id="ltShow"'
      + (cur.showInToday !== false ? ' checked' : '') + '>'
      + '<span>在今日页显示（放在作业卡片的「长期任务」小节里，和作业分开统计）</span></label>'
      + '</div>');
    var units = ['小时', '次', '篇', '公里', '页'];
    var ubox = el('<div class="lt-units"></div>');
    body.querySelector('#ltUnit').parentNode.appendChild(ubox);
    for (var u = 0; u < units.length; u++) {
      (function (txt) {
        var b = el('<button class="chip-btn" type="button">' + txt + '</button>');
        b.addEventListener('click', function () {
          body.querySelector('#ltUnit').value = txt;
          AR.Bridge.haptic('light', b);
        });
        ubox.appendChild(b);
      })(units[u]);
    }
    var sws = body.querySelectorAll('#ltColors .swatch');
    for (var k = 0; k < sws.length; k++) {
      (function (sw) {
        sw.addEventListener('click', function () {
          picked = sw.getAttribute('data-color');
          for (var m = 0; m < sws.length; m++) { sws[m].classList[sws[m] === sw ? 'add' : 'remove']('active'); }
          AR.Bridge.haptic('light', sw);
        });
      })(sws[k]);
    }
    var actions = [];
    if (!isNew) {
      actions.push({
        label: '删除', kind: 'danger', onClick: function (close) {
          openModal({
            title: '删除这项长期任务？',
            sub: (cur.name || '') + ' · ' + ltNum((AR.Store.longTaskStats(cur, U.dateKey(new Date()))).total)
              + (cur.unit ? ' ' + cur.unit : ''),
            body: '<p class="muted">记录会一起删掉，删了就找不回来。'
              + '只是想让它不在今日页出现的话，关掉「在今日页显示」就行。</p>',
            actions: [
              { label: '取消', onClick: function (c2) { c2(); openLongTaskEdit(cur); } },
              {
                label: '确认删除', kind: 'danger', onClick: function (c2) {
                  AR.Store.longTaskRemove(cur.id);
                  AR.Bridge.haptic('warn', $('modalCard'));
                  c2();
                  AR.UI.refreshHomeworkPanels();
                  refreshHomework();
                  toast('已删除：' + (cur.name || ''));
                }
              }
            ]
          });
        }
      });
    }
    actions.push({
      label: '保存', kind: 'primary', onClick: function (close) {
        var name = (body.querySelector('#ltName').value || '').trim();
        if (!name) { toast('先给它起个名字'); return; }
        var patch = {
          name: name,
          unit: (body.querySelector('#ltUnit').value || '').trim() || '次',
          target: Number(body.querySelector('#ltTarget').value) || 0,
          colorKey: picked,
          showInToday: !!body.querySelector('#ltShow').checked
        };
        if (!isNew) { patch.id = cur.id; }
        var saved = AR.Store.longTaskUpsert(patch);
        AR.Bridge.haptic('medium', $('modalCard'));
        close();
        AR.UI.refreshHomeworkPanels();
        refreshHomework();
        toast((isNew ? '已新建：' : '已保存：') + (saved ? saved.name : name));
      }
    });
    actions.push({ label: '取消', onClick: function (close) { close(); } });
    openModal({
      title: isNew ? '新建长期任务' : '编辑长期任务',
      sub: isNew ? '比如「志愿时长 · 目标 20 小时」' : (cur.name || ''),
      body: body,
      actions: actions
    });
  }

  /**
   * 作业面板。
   *   mode = 'today' → 一条汇总（点开就地展开，默认收起）
   *   mode = 'next'  → 直接铺开条目（当天课都上完之后）
   */
  function homeworkNode(mode) {
    var board = AR.Store.taskBoard ? AR.Store.taskBoard(U.dateKey(new Date())) : { open: [], done: [], doneWeek: [] };
    var openN = board.open.length, doneN = board.done.length;
    var weekN = (board.doneWeek || []).length;
    var ltList = AR.Store.longTaskTodayList ? AR.Store.longTaskTodayList() : [];
    var ltN = ltList.length;
    if (mode === 'today') {
      var wrap = el('<div class="hw-card" id="hwToday"></div>');
      if (!openN && !doneN && !weekN && !ltN) { wrap.hidden = true; return wrap; }
      var sum = el('<button class="hw-sum" type="button">'
        + '<span class="hw-ico">✎</span>'
        + '<span class="hw-t">作业</span>'
        + '<span class="hw-n">' + (openN ? openN + ' 条未完成' : '已全部完成')
        + (doneN ? ' · 已完成 ' + doneN : '')
        + (ltN ? ' · 长期任务 ' + ltN : '') + '</span>'
        + '<span class="hw-chev">▸</span></button>');
      var body = el('<div class="hw-body"></div>');
      body.hidden = !hwOpen;
      body.appendChild(hwListBox(board));
      var lt = longTaskNode();
      if (lt) { body.appendChild(lt); }
      sum.addEventListener('click', function () {
        AR.Bridge.haptic('light', sum);
        hwOpen = !hwOpen;
        toggleHwBox(body, hwOpen);
        sum.classList.toggle('open', hwOpen);
      });
      wrap.appendChild(sum);
      wrap.appendChild(body);
      return wrap;
    }
    var box = el('<div class="hw-card" id="hwNext"></div>');
    if (!openN && !doneN && !weekN && !ltN) { box.hidden = true; return box; }
    box.appendChild(el('<div class="hw-head"><span class="hw-ico">✎</span><span class="hw-t">今日作业</span>'
      + '<span class="hw-n">' + (openN ? openN + ' 条未完成' : '已全部完成')
      + (ltN ? ' · 长期任务 ' + ltN : '') + '</span></div>'));
    box.appendChild(hwListBox(board));
    var ltNext = longTaskNode();
    if (ltNext) { box.appendChild(ltNext); }
    return box;
  }

  /** 只重画作业面板（不整页重画，展开状态和滚动位置都不受影响） */
  function refreshHomework() {
    var a = $('hwToday');
    if (a && a.parentNode) { a.parentNode.replaceChild(homeworkNode('today'), a); }
    var b = $('hwNext');
    if (b && b.parentNode) { b.parentNode.replaceChild(homeworkNode('next'), b); }
  }

  /**
   * 设置 → 课程与课表 →「作业记录…」：作业统计 + 找回隐藏的已完成。
   *
   * 「已完成」在界面上只保留今天（更早的折进小分组、超过一周不显示），
   * 这里能看到**全部**记录（含被隐藏的），并能长按找回 / 删除 / 批量清理。
   */
  function openTaskLog() {
    var all = (AR.Store.get().tasks || []).slice();
    var todayK = U.dateKey(new Date());
    var weekAgo = U.dateKey(U.addDays(new Date(), -6));
    var open = [], doneToday = [], doneRest = [];
    var byCourse = {};
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      var dd = AR.Store.taskDoneDay ? AR.Store.taskDoneDay(t) : '';
      if (!t.done) { open.push(t); } else if (dd === todayK) { doneToday.push(t); } else { doneRest.push(t); }
      var c = AR.Store.courseById(t.courseId);
      var name = c ? c.name : '（课程已删）';
      byCourse[name] = byCourse[name] || { open: 0, done: 0 };
      if (t.done) { byCourse[name].done++; } else { byCourse[name].open++; }
    }
    var doneWeek = 0;
    for (var w = 0; w < all.length; w++) {
      var dw = AR.Store.taskDoneDay ? AR.Store.taskDoneDay(all[w]) : '';
      if (all[w].done && dw && dw >= weekAgo) { doneWeek++; }
    }
    var body = el('<div class="task-log">'
      + '<div class="tl-stats">'
      + '<div class="tl-stat"><b>' + open.length + '</b><span>未完成</span></div>'
      + '<div class="tl-stat"><b>' + doneToday.length + '</b><span>今天完成</span></div>'
      + '<div class="tl-stat"><b>' + doneWeek + '</b><span>本周完成</span></div>'
      + '<div class="tl-stat"><b>' + (all.length - open.length) + '</b><span>累计完成</span></div>'
      + '</div></div>');
    // 按课程统计
    var names = Object.keys(byCourse);
    if (names.length) {
      var box1 = el('<div class="tl-group"><div class="tl-title">按课程</div></div>');
      names.sort(function (a, b) { return byCourse[b].open - byCourse[a].open; });
      for (var n = 0; n < names.length; n++) {
        box1.appendChild(el('<div class="tl-line"><span class="tl-name">' + U.escapeHtml(names[n]) + '</span>'
          + '<span class="tl-num">未完成 ' + byCourse[names[n]].open + ' · 已完成 ' + byCourse[names[n]].done + '</span></div>'));
      }
      body.appendChild(box1);
    }
    body.appendChild(taskLogGroup('未完成', open, false));
    body.appendChild(taskLogGroup('今天完成', doneToday, true));
    body.appendChild(taskLogGroup('更早的已完成（含已隐藏的）', doneRest, true));

    openModal({
      title: '作业记录', sub: '共 ' + all.length + ' 条 · 长按已完成可找回', body: body, wide: true,
      actions: [
        {
          label: '清理 30 天前的已完成', onClick: function () {
            var cut = U.dateKey(U.addDays(new Date(), -30));
            var S = AR.Store.get();
            var keep = [];
            var removed = 0;
            for (var i2 = 0; i2 < (S.tasks || []).length; i2++) {
              var t2 = S.tasks[i2];
              var d2 = t2.doneAt ? String(t2.doneAt) : '';
              if (t2.done && d2 && d2.slice(0, 10) < cut) { removed++; continue; }
              keep.push(t2);
            }
            S.tasks = keep;
            AR.Store.save(true);
            AR.UI.toast(removed ? ('已清理 ' + removed + ' 条') : '没有被清理的记录');
            refreshHomework();
          }
        },
        { label: '关闭', kind: 'primary', onClick: function (c) { c(); } }
      ]
    });
  }

  /** 作业记录里的一块列表（done=true 的条目长按可找回、点右侧删除） */
  function taskLogGroup(title, list, isDone) {
    var box = el('<div class="tl-group"><div class="tl-title">' + title + ' · ' + list.length + '</div></div>');
    if (!list.length) { box.appendChild(el('<div class="muted" style="padding:4px 2px">没有记录</div>')); return box; }
    for (var i = 0; i < list.length; i++) {
      (function (t) {
        var when = isDone ? (AR.Store.taskDoneDay ? AR.Store.taskDoneDay(t) : '') : (t.date || '');
        var row = el('<div class="tl-row' + (isDone ? ' done' : '') + '">'
          + '<span class="tl-text">' + U.escapeHtml(t.text) + '</span>'
          + '<span class="tl-when">' + (when || '') + '</span>'
          + '<button class="tl-del" type="button" title="删除">✕</button></div>');
        if (isDone) {
          bindLongPress(row, function () {
            AR.Store.setTaskDone(t.id, false);
            AR.Bridge.haptic('medium', row);
            AR.UI.toast('已找回：「' + t.text + '」');
            refreshHomework();
          }, 600);
        }
        row.querySelector('.tl-del').addEventListener('click', function (ev) {
          ev.stopPropagation();
          AR.Store.removeTask(t.id);
          AR.Bridge.haptic('warn', row);
          refreshHomework();
          row.parentNode.removeChild(row);
        });
        box.appendChild(row);
      })(list[i]);
    }
    return box;
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
   * 所有"切换日期"共用的内容过渡。
   *
   * 姿态来自 motion 注册表的 dateSwitch 场景（开发者模式里可换样式）：
   *   dir  → 位移跟着方向走：往后一天从右边滑进来，往前一天从左边滑进来；
   *   flip → 方向感更强，绕 Y 轴从那一侧翻进来；
   * 只动 opacity / transform，曲线一律非线性，收尾长、起步快。
   *
   * nodes 是"内容层"（今日日程 / 最近的课 / 本周概览），节点是刚重画出来的，
   * 所以动画直接作用在新内容上，不会看到旧内容闪一下。
   */
  function playDateShift(nodes, dir) {
    if (!nodes || !nodes.length) { return; }
    var st = AR.Motion ? AR.Motion.get('dateSwitch') : null;
    var speed = motionSpeed();
    var dur = st ? Math.round((st.dur || 0) / speed) : Math.round(340 / speed);
    if (!dur) { return; }
    var ease = AR.Motion ? AR.Motion.ease(st && st.ease) : 'cubic-bezier(.16,1,.30,1)';
    var d = dir > 0 ? 1 : (dir < 0 ? -1 : 0);
    var dx = ((st && st.x) || 0) * ((st && st.dir) ? d : 1);
    var dy = (st && st.y) || 0;
    var s0 = (st && st.s != null) ? st.s : .99;
    var flip = !!(st && st.flip && d);
    var o0 = (st && st.o != null) ? st.o : .2;
    var from = [];
    if (flip) { from.push('perspective(760px) rotateY(' + (d > 0 ? -64 : 64) + 'deg)'); }
    if (dx || dy) { from.push('translate3d(' + dx + 'px,' + dy + 'px,0)'); }
    if (s0 !== 1) { from.push('scale(' + s0 + ')'); }
    var frames = [
      { opacity: o0, transform: from.length ? from.join(' ') : 'none' },
      { opacity: 1, transform: 'none' }
    ];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || !n.animate) { continue; }
      if (n.__dateAnim) { try { n.__dateAnim.cancel(); } catch (e) { } }
      n.__dateAnim = n.animate(frames, { duration: dur, easing: ease, fill: 'none' });
    }
  }

  /**
   * 「本周概览」的日期滑块。
   *
   * 表格每渲染一次就换一批 DOM（滑块也跟着没了），所以坐标记在模块变量里：
   * 重画后先把滑块"放"到上次的位置，再滑到这一天的位置 —— 看上去才是一块
   * 连续的滑块。表格尺寸/形态变了（缩小 ↔ 聚焦放大、横竖屏切换）就直接落位，
   * 免得出现一次莫名其妙的横跨全表的滑动。
   */
  var dayPillMemo = { sig: '', day: '', x: 0, y: 0, w: 0, h: 0 };

  function slideDayPill(body) {
    var table = body ? body.querySelector('.mini-table, .week-table') : null;
    if (!table) { dayPillMemo.sig = ''; dayPillMemo.day = ''; return; }
    var existing = table.querySelector('.day-pill');
    var sel = table.querySelector('.mg-day.picked, .wt-day.picked');
    if (!sel) {
      // 正在看的那天不在这一周（缩略图只有周一到周五，周末就会走到这里）
      if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }
      dayPillMemo.sig = ''; dayPillMemo.day = '';
      return;
    }
    var mode = table.classList.contains('mini-table') ? 'mini' : 'full';
    var sig = mode + '|' + Math.round(table.clientWidth) + 'x' + Math.round(table.clientHeight);
    var dayKey = sel.getAttribute('data-date') || '';
    var x = sel.offsetLeft, y = sel.offsetTop, w = sel.offsetWidth, h = sel.offsetHeight;
    // 同一次操作里会走到这里两次（先渲染、后播过渡），第二次保持原样，
    // 否则会把正在播的滑动动画打断，看上去就成了"闪一下"
    if (existing && existing.__tx === x && existing.__ty === y && existing.__tw === w) { return; }
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }
    var pill = document.createElement('span');
    pill.className = 'day-pill';
    pill.style.width = w + 'px';
    pill.style.height = h + 'px';
    pill.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    pill.__tx = x; pill.__ty = y; pill.__tw = w;
    table.appendChild(pill);
    /**
     * 只有"同一张表、换了另一天"才滑：上次记下的那天和这次不是同一天，
     * 且表格几何没变（形态没换、没转屏），上次的坐标才依然有效。
     *
     * 曲线用「强缓出」而不是回弹：滑块是位置指示，一弹就像在抖；
     * 全程非线性、起步快收尾长，才是"滑过去、停稳"的观感。
     */
    var prev = dayPillMemo;
    var slide = prev.sig === sig && prev.day && prev.day !== dayKey;
    var speed = motionSpeed();
    var dur = Math.round(340 / speed);
    if (slide && pill.animate) {
      pill.animate(
        [
          { transform: 'translate(' + prev.x + 'px,' + prev.y + 'px)', width: prev.w + 'px', height: prev.h + 'px' },
          { transform: 'translate(' + x + 'px,' + y + 'px)', width: w + 'px', height: h + 'px' }
        ],
        {
          duration: dur,
          easing: AR.Motion ? AR.Motion.ease('expo') : 'cubic-bezier(.16,1,.30,1)',
          fill: 'none'
        }
      );
    }
    dayPillMemo = { sig: sig, day: dayKey, x: x, y: y, w: w, h: h };
    /**
     * 表格尺寸一变就重新贴一次：放大 / 缩小时渲染那一刻量到的列坐标可能是
     * 动画中的值，靠 ResizeObserver 在布局真正落定后再校准一遍。
     */
    if (typeof ResizeObserver === 'function') {
      if (table.__ro) { try { table.__ro.disconnect(); } catch (e) { } }
      table.__ro = new ResizeObserver(function () { slideDayPill(body); });
      table.__ro.observe(table);
    }
  }

  /**
   * 表格几何变了以后把滑块重新贴回去。
   *
   * 卡片放大 / 缩小时内容是"按最终尺寸排版、被栏框裁着露出来"的，
   * 渲染那一刻量到的列坐标还属于旧宽度 —— 不再贴一次，滑块就偏在旧位置
   * （用户看到的"卡片放大缩小后选择框错位"）。
   * 立刻贴一次（等冻结层重排完），补间结束后再贴一次（等真实布局落定）。
   */
  var pillSyncTimer = 0;
  function syncDayPillSoon() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { slideDayPill($('weekBody')); syncRailSegPillSoon(); });
    }
    if (pillSyncTimer) { clearTimeout(pillSyncTimer); }
    pillSyncTimer = setTimeout(function () {
      pillSyncTimer = 0;
      slideDayPill($('weekBody'));
      syncRailSegPillSoon();
    }, 620);
  }

  /**
   * 「本周课表 / 月视图」的胶囊也要跟着重新对齐。
   *
   * 卡片放大 / 缩小时，渲染那一刻栏框还是旧尺寸（内容按最终尺寸钉住），
   * 那时量出来的分段控件宽度是旧的 —— 不重新摆一次，胶囊就会比格子宽一截、
   * 位置也偏（用户看到的"滑块有 bug"）。
   */
  function syncRailSegPillSoon() {
    var seg = document.querySelector('#weekBody .segmented');
    // 只是"布局变了再校一次"，不播补间（避免进场时那种错位放大）
    if (seg) { syncSegPill(seg, false); }
  }

  /**
   * 「本周概览」里切换日期：内容按方向滑入 + 日期栏滑块滑到新位置
   * （落定的轻收也在滑块自己身上，不再另画一圈框）。
   */
  function playDaySwitch(dir) {
    var zone = $('zoneWeek');
    if (!zone) { return; }
    var body = zone.querySelector('.zone-body');
    if (!body) { return; }
    playDateShift([body], dir);
    slideDayPill(body);
  }

  /**
   * 今日页「今天 / 前一天 / 后一天」（以及在本周概览里点某一天）。
   *
   * 三处一起动才有"翻页"的感觉：
   *   ① 今日日程 + 最近的课：按方向滑入；
   *   ② 顶栏时钟与副标题：轻轻落定一下（时间确实变了，得看得见）；
   *   ③ 本周概览：内容同样按方向滑入，日期栏的滑块滑过去。
   */
  function playTodaySwitch(dir) {
    playDateShift([$('todayBody'), $('nextBody')], dir);
    collapseDoneGroups();          // 换一天：作业的两个"已完成"区都回到收起
    var speed = motionSpeed();
    var ease = AR.Motion ? AR.Motion.ease('expo') : 'cubic-bezier(.16,1,.30,1)';
    var clock = $('todayClock');
    if (clock && clock.animate) {
      if (clock.__dateAnim) { try { clock.__dateAnim.cancel(); } catch (e) { } }
      clock.__dateAnim = clock.animate(
        [{ opacity: .25, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
        { duration: Math.round(280 / speed), easing: ease, fill: 'none' }
      );
    }
    var sub = $('todaySub');
    if (sub && sub.animate) {
      if (sub.__dateAnim) { try { sub.__dateAnim.cancel(); } catch (e) { } }
      sub.__dateAnim = sub.animate(
        [{ opacity: .25 }, { opacity: 1 }],
        { duration: Math.round(260 / speed), easing: ease, fill: 'none' }
      );
    }
    playDaySwitch(dir);
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
  /**
   * 页面进场的错峰节点。
   * enterRise（整块上浮）和 enterSegPill（滑块进场）**共用**这份名单与位次算法，
   * 否则两边各算一套时间线，滑块就会和自己的卡片错拍。
   */
  /**
   * 注意：周表页的「周视图 / 月视图」在 .week-bar 里，而 .week-strip（周次快切）
   * 是 .week-bar 的**子元素** —— 名单里只留 .week-bar，否则父子各播一遍会双重淡入。
   */
  var RISE_SEL = '.view-head, .week-bar, .zone, .glass.panel, .settings-nav, .set-section';

  function riseNodes(root) {
    return (root && root.querySelectorAll) ? root.querySelectorAll(RISE_SEL) : [];
  }

  /** 节点在它所属 .view 里的错峰位次；不在名单里返回 -1 */
  function riseSlotOf(node) {
    if (!node || !node.closest) { return -1; }
    var nodes = riseNodes(node.closest('.view') || document);
    for (var i = 0; i < nodes.length; i++) { if (nodes[i] === node) { return i; } }
    return -1;
  }

  /** 第 slot 个进场节点的延迟（ms，未除动画速度） */
  function riseDelay(slot, m) {
    var stagger = m ? (m.stagger != null ? m.stagger : 0) : 60;
    var base = (m && m.stagger === 0) ? 0 : 50;
    return base + (slot > 0 ? slot * stagger : 0);
  }

  function enterRise(viewEl) {
    if (!viewEl || !viewEl.querySelectorAll) { return; }
    var m = AR.Motion ? AR.Motion.get('viewIn') : null;
    if (m && !m.dur) { return; }                       // 「无动画」
    var speed = motionSpeed();
    var nodes = riseNodes(viewEl);
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
        { duration: dur, delay: Math.round(riseDelay(i, m) / speed), easing: ease, fill: 'backwards' }
      );
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
          delay: Math.round((i * (m ? (m.stagger != null ? m.stagger : 30) : 30)) / speed),
          easing: AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.22,1,.36,1)',
          fill: 'backwards'
        }
      );
    }
  }

  /**
   * 分段控件 + 底部 Tab 栏的滑块统一入口。
   *
   * 所有滑块（今日页三栏、本周概览周/月、周表页周/月、设置页各分段、导入页 tab、
   * 底部 Tab）都走这里，外观不变，动画参数统一来自 AR.Motion：
   *   · **只有"选中项真的换了"才滑动**（从旧位置滑到新位置，360ms，跟随动画速度）；
   *   · 进场 / 重画 / 校准 / 转屏一律**直接落位**，不播任何补间 ——
   *     以前这些情况也会补间一次，看着就是"滑块自己错位放大一下"；
   *   · 面板重画把正在播的动画丢掉时，靠 segMemos 里记的起点**续播**。
   * withEnter=true（切页时）额外给滑块播一次统一的进场淡入。
   */
  function enhanceSegmented(root, withEnter) {
    var segs = (root || document).querySelectorAll('.segmented');
    for (var i = 0; i < segs.length; i++) {
      syncSegPill(segs[i], true, withEnter);
    }
    syncSegmentsSoon(root);
    syncTabPill(true, withEnter);
  }

  /**
   * 滑块进场。
   *
   * ① 页面进场时：滑块所在的整块（.week-strip / .zone / .set-section …）正在播
   *    viewIn 的错峰上浮，胶囊是它的子元素 —— 跟着一起淡入就够了。
   *    以前这里自己叠一条 contentIn 淡入（0ms 起 300ms），和整块的
   *    「50ms 起、500ms 错峰」对不上拍，看着就是"从底部 Tab 切到周表时，
   *    周视图/月视图那颗滑块没跟其它元素一起加载"。
   * ② 没有整块动画的场合（局部重画、卡片里刚生成的控件）：补一次轻淡入。
   */
  function enterSegPill(cont, cls) {
    var pill = cont && cont.querySelector('.' + (cls || 'seg-pill'));
    if (!pill || !pill.animate) { return; }
    if (pill.__anim) { return; }                    // 正在滑动：别用淡入抢它的 transform
    var block = cont.closest ? cont.closest(RISE_SEL) : null;
    if (block && block.__rise) { return; }          // 跟着整块的 viewIn 走，别另起一条时间线
    var m = AR.Motion ? AR.Motion.get('contentIn') : null;
    if (m && !m.dur) { return; }
    var dur = Math.round(((m && m.dur) || 300) / motionSpeed());
    var y = (m && m.y) || 6;
    var x = pill.__x || 0, at = pill.__y || 0;
    if (pill.__enter) { try { pill.__enter.cancel(); } catch (e) { } }
    pill.__enter = pill.animate(
      [
        { opacity: 0, transform: 'translate3d(' + x + 'px,' + (at + y) + 'px,0)' },
        { opacity: 1, transform: 'translate3d(' + x + 'px,' + at + 'px,0)' }
      ],
      { duration: dur, easing: AR.Motion ? AR.Motion.ease(m && m.ease) : 'cubic-bezier(.16,1,.3,1)', fill: 'none' }
    );
  }

  /**
   * 底部 Tab 栏的滑块：和分段控件同一套逻辑（同一位置算法、同一动画参数），
   * 只是把格子换成 .nav-btn、胶囊换成 .tab-pill。
   */
  function syncTabPill(animate, withEnter) {
    var bar = document.querySelector('.tabbar');
    if (!bar) { return; }
    var active = bar.querySelector('.nav-btn.active') || bar.querySelector('.nav-btn');
    if (!active) { return; }
    syncPillOn(bar, {
      items: '.nav-btn', active: active, activeSel: '.nav-btn.active',
      pillClass: 'tab-pill', key: 'tabbar', animate: animate, enter: withEnter
    });
  }

  /**
   * 分段控件的滑块"再校一次"（不播补间，纯对齐）：
   * 面板刚插进 DOM、字体晚到、滚动条刚出现这类**异步布局**都靠它兜底。
   * 几何量的是布局值（见 pillGeom），所以入场动画播到一半量也不会算错；
   * 真在播的滑动不会被这两次校准打断（syncPillOn 里有判断）。
   */
  function syncSegments(root) {
    var segs = (root || document).querySelectorAll('.segmented');
    for (var i = 0; i < segs.length; i++) { syncSegPill(segs[i], false); }
  }

  function syncSegmentsSoon(root) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { syncSegments(root); });
    }
    setTimeout(function () { syncSegments(root); }, 560);
  }

  /**
   * 分段控件的"身份"：面板重渲染后元素是新的，只能靠 id + 各段文字认人。
   * 这样同一个控件换了活 DOM 也认得出是它，滑块才滑得起来。
   */
  var segMemos = {};
  function segKeyOf(seg) {
    if (seg.id) { return 'id:' + seg.id; }
    /**
     * 没有 id 的控件靠"面板 + 同级序号 + 各段文字"认人。
     * 序号不能省：设置页里两个控件都叫「中」（质感模糊效果 / 震动强度），
     * 只用文字当键会共用同一份记忆，滑块就会从**另一个控件**的坐标开始滑。
     */
    var host = seg.closest ? seg.closest('[id]') : null;
    var sibs = host ? host.querySelectorAll('.segmented') : [seg];
    var idx = 0;
    for (var s = 0; s < sibs.length; s++) { if (sibs[s] === seg) { idx = s; break; } }
    var kids = seg.querySelectorAll('.seg');
    var labels = [];
    for (var i = 0; i < kids.length; i++) { labels.push(String(kids[i].textContent).trim()); }
    return 'k:' + (host ? host.id : '') + '#' + idx + '|' + labels.join(',');
  }

  /**
   * 分段控件里"胶囊滑块"的位置。
   *
   * 绝对定位的起点是 **padding box**（= 边框盒 + 边框宽），而格子（.seg）
   * 从内容盒开始 —— 中间差着 padding。所以：
   *     x = 格子左边 - 容器左边 - 边框宽      （padding 不能减，它本来就该算进去）
   * 以前用 offsetLeft 当 translateX，不同控件的 padding / border 不一样，
   * 滑块就会整体偏几像素（用户看到的"滑块有 bug"）。
   */
  /* ── 滑块几何：位置的唯一来源 ─────────────────────────────── */

  /**
   * 量一个格子在"容器坐标系"里的位置与尺寸。
   *
   * ⚠️ 不能直接用 getBoundingClientRect 算。卡片 / 面板进场、磁贴翻转时整块会带
   *    scale / rotateX / rotateY，rect 量到的是**投影后**的几何 —— 照它画出来的滑块
   *    会又小又偏，要等动画播完才"跳"回正常。用户看到的
   *    "刚进页面滑块小一圈、过一会儿才长大 / 位置偏一截"就是这个病根。
   *
   * 主路径走 offset 链（offsetLeft / offsetTop / offsetWidth / offsetHeight）：
   * 它们是**布局值**，不受祖先 transform 影响，动画播到一半量也是准的。
   * 容器没有被缩放时，再用 rect 的小数部分把 offset 的取整误差补回来（<1px）。
   */
  function pillGeom(cont, cell) {
    var x = 0, y = 0, n = cell, reached = false;
    while (n) {
      if (n === cont) { reached = true; break; }
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    var r = cont.getBoundingClientRect ? cont.getBoundingClientRect() : null;
    var ow = cont.offsetWidth;
    var scale = (r && ow > 0 && r.width > 0) ? (r.width / ow) : 1;
    if (!r || !scale) { scale = 1; }
    var cs = getComputedStyle(cont);
    var bl = parseFloat(cs.borderLeftWidth) || 0;
    var bt = parseFloat(cs.borderTopWidth) || 0;
    /**
     * 兜底：容器不在 offsetParent 链上（样式被改过 / 容器本身是 static）。
     * 这时只能退回 rect，但用容器自身的缩放比折算回"布局尺寸"，
     * 所以进场动画把它缩到 .92 也不会算错。
     */
    if (!reached) {
      var cc = cell.getBoundingClientRect();
      return {
        x: (cc.left - r.left) / scale - bl,
        y: (cc.top - r.top) / scale - bt,
        w: cc.width / scale,
        h: cc.height / scale
      };
    }
    var g = { x: x, y: y, w: cell.offsetWidth, h: cell.offsetHeight };
    if (cell.getBoundingClientRect && Math.abs(scale - 1) < 0.004) {
      var cr = cell.getBoundingClientRect();
      var dx = (cr.left - r.left) - bl - g.x;
      var dy = (cr.top - r.top) - bt - g.y;
      var dw = cr.width - g.w;
      var dh = cr.height - g.h;
      // 只采纳"亚像素级"的差；差得多说明量的不是同一个坐标系，宁可不要
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dw) < 1 && Math.abs(dh) < 1) {
        g.x += dx; g.y += dy; g.w += dw; g.h += dh;
      }
    }
    return g;
  }

  /**
   * 落位：把几何写进样式。
   * 动画只是"盖在上面播"，所以任何时刻掐掉动画都不会跳 —— 这也是
   * "进场 / 重画 / 尺寸变化直接落位、不播补间"能成立的前提。
   */
  function writePill(pill, g) {
    pill.style.top = g.y + 'px';
    pill.style.width = g.w + 'px';
    pill.style.height = g.h + 'px';
    pill.style.transformOrigin = '0 0';
    pill.style.transform = 'translateX(' + g.x + 'px)';
    pill.style.opacity = '';
    pill.__x = g.x; pill.__y = g.y; pill.__w = g.w; pill.__h = g.h;
  }

  /** 掐断正在播的滑动（几何已经写对了，不需要它补完） */
  function stopPillAnim(pill) {
    if (pill && pill.__anim) {
      try { pill.__anim.cancel(); } catch (e) { }
      pill.__anim = null;
    }
  }

  /**
   * 从 from 滑到 to（都是"容器坐标系"里的几何）。
   * 同时补间 translateX / top / width / height，曲线与时长走统一的 AR.Motion。
   */
  function slidePill(pill, from, to, dur) {
    if (!pill.animate || !(dur > 0)) { return null; }
    /**
     * 进场淡入在播就先收掉：它同样写 transform，跟滑动同播会互相抢。
     * （先有一次"没动"的 sync 建了淡入、紧接着一次"要滑"的 sync ——
     *  切 Tab 的双 sync 就是这个次序；enterSegPill 那边有 __anim 守卫，
     *  两个方向都堵上之后，淡入和滑动永远互斥。）
     */
    if (pill.__enter) {
      try { pill.__enter.cancel(); } catch (e) { }
      pill.__enter = null;
    }
    var fx = 'translateX(' + from.x + 'px)';
    var tx = 'translateX(' + to.x + 'px)';
    pill.style.transform = fx;
    pill.style.top = from.y + 'px';
    pill.style.width = from.w + 'px';
    pill.style.height = from.h + 'px';
    void pill.offsetWidth;               // 让浏览器拿"起点"当第一帧
    var anim = pill.animate(
      [
        { transform: fx, top: from.y + 'px', width: from.w + 'px', height: from.h + 'px' },
        { transform: tx, top: to.y + 'px', width: to.w + 'px', height: to.h + 'px' }
      ],
      {
        duration: dur,
        easing: AR.Motion ? AR.Motion.ease('emphasized') : 'cubic-bezier(.05,.70,.10,1)',
        fill: 'none'
      }
    );
    writePill(pill, to);                 // 落位（动画盖在上面播）
    pill.__anim = anim;
    anim.onfinish = function () { if (pill.__anim === anim) { pill.__anim = null; } };
    return anim;
  }

  /**
   * 布局变了（卡片展开 / 收起、转屏、滚动条出现、布局滑块拖动）时重新对齐。
   *
   * 规则只有一条：**跟着格子逐帧走**，自己不播几何补间。
   * 卡片展开时 ResizeObserver 每帧都会叫一次，每一帧都把滑块贴到格子当前的位置上
   * —— 观感就是滑块被格子一起"推"过去，既不滞后也不会自己放大一圈。
   *
   * 如果这一刻正好有一次滑动在播（用户刚点了另一格），就从**画面上的当前位置**
   * 重新指向新终点，剩余时间照给：相当于给动画换了个终点，而不是打断它。
   */
  function reflowPill(cont) {
    if (!cont) { return; }
    if (!cont.isConnected) {
      if (cont.__ro) { try { cont.__ro.disconnect(); } catch (e) { } cont.__ro = null; }
      return;
    }
    var opts = cont.__pillOpts;
    if (!opts) { return; }
    var cls = opts.pillClass || 'seg-pill';
    var pill = cont.querySelector('.' + cls);
    var active = cont.querySelector(opts.activeSel) || cont.querySelector(opts.items);
    if (!pill || !active) { return; }
    var g = pillGeom(cont, active);
    if (!g.w || !g.h) { return; }
    var key = opts.key || '';
    var memo = segMemos[key];
    /**
     * 尺寸没变就直接返回。
     * ResizeObserver 在"开始观察"时也会先给一次回调（首次投递），
     * 不看这一眼的话，刚点出来的滑动会被自己这一次回调掐掉 —— 就是"点了没动画"。
     */
    if (memo && Math.abs(memo.x - g.x) < 0.5 && Math.abs(memo.y - g.y) < 0.5
      && Math.abs(memo.w - g.w) < 0.5 && Math.abs(memo.h - g.h) < 0.5) { return; }
    var live = (memo && memo.anim && pill.__anim) ? memo.anim : null;
    var cur = null;
    var left = 0;
    if (live) {
      // 用动画的**缓动后进度**在"起点 → 上一次的终点"之间插值，得到画面上的当前位置。
      // 进度为 0（刚起步）时 cur 就是原起点，等价于"重新指向新终点"而不是打断。
      var p = 0;
      try { p = pill.__anim.effect.getComputedTiming().progress; } catch (e) { p = 0; }
      if (p == null || isNaN(p)) { p = 1; }
      p = Math.max(0, Math.min(1, p));
      cur = {
        x: live.x + (memo.x - live.x) * p,
        y: live.y + (memo.y - live.y) * p,
        w: live.w + (memo.w - live.w) * p,
        h: live.h + (memo.h - live.h) * p
      };
      left = Math.max(120, live.dur - (Date.now() - live.at));
    }
    stopPillAnim(pill);
    writePill(pill, g);
    if (memo) { memo.x = g.x; memo.y = g.y; memo.w = g.w; memo.h = g.h; memo.anim = null; }
    if (cur && memo && memo.idx != null) {
      if (!left) { left = Math.max(140, Math.round(220 / motionSpeed())); }
      if (slidePill(pill, cur, g, left)) {
        memo.anim = { x: cur.x, y: cur.y, w: cur.w, h: cur.h, toIdx: memo.idx, at: Date.now(), dur: left };
      }
    }
  }

  /**
   * 尺寸一变就重新对齐。
   * 容器挂 ResizeObserver（content-box：滚动条出现 / 消失也算尺寸变化），
   * 回调里只做"跟着走"；observer 只挂一次（重挂会自己触发自己）。
   */
  function observeSegSize(cont, opts) {
    if (!cont) { return; }
    cont.__pillOpts = opts;
    if (typeof ResizeObserver !== 'function') { return; }
    if (cont.__ro) { return; }
    cont.__ro = new ResizeObserver(function () { reflowPill(cont); });
    try { cont.__ro.observe(cont, { box: 'content-box' }); }
    catch (e) { cont.__ro.observe(cont); }
  }

  function syncSegPill(seg, animate, enter) {
    if (!seg) { return; }
    syncPillOn(seg, {
      items: '.seg', activeSel: '.seg.active',
      pillClass: 'seg-pill', key: segKeyOf(seg), animate: animate, enter: enter
    });
  }

  /**
   * 滑块的通用实现：任何"一排格子 + 一个选中项"都能用
   * （分段控件 .seg/.seg-pill、底部 Tab 栏 .nav-btn/.tab-pill）。
   *
   * 显式状态机，只有三种动作：
   *   ① 落位 —— 按选中格子的**布局**几何摆好滑块；
   *   ② 滑动 —— 选中项序号**真的变了**才从旧位置滑过去（360ms，跟随动画速度）；
   *   ③ 续播 —— 滑动被重画打断时，接着它的起点把剩余时长播完。
   * 进场 / 重画 / 校准 / 转屏一律走 ①，不播任何几何补间。
   */
  function syncPillOn(cont, opts) {
    var active = opts.active || cont.querySelector(opts.activeSel) || cont.querySelector(opts.items);
    if (!active) { return; }
    var cls = opts.pillClass || 'seg-pill';
    var pill = cont.querySelector('.' + cls);
    if (!pill) {
      pill = document.createElement('span');
      pill.className = cls;
      cont.insertBefore(pill, cont.firstChild);
    }
    var g = pillGeom(cont, active);
    if (!g.w || !g.h) { return; }        // 还没拿到布局：下一帧还会被叫一次
    var kids = cont.querySelectorAll(opts.items);
    var idx = 0;
    for (var i = 0; i < kids.length; i++) { if (kids[i] === active) { idx = i; break; } }
    var key = opts.key || '';
    var memo = segMemos[key];
    var same = !!(memo && memo.count === kids.length);
    var now = Date.now();
    var dur = Math.max(120, Math.round(360 / motionSpeed()));

    /**
     * 正在滑、而且终点没变（几处"过一会儿再校一次"正好落在滑动中间）：
     * 放它播完，别打断 —— 以前这种情况会把动画掐掉，看起来就是"没有动画"。
     * 这里也**不能**补进场淡入：enterSegPill 同样写 transform / opacity，
     * 会把正在播的滑动盖成"原地淡入"（点设置时滑块瞬移就是这么来的 ——
     * renderSettings 与 show() 各同步了一次滑块，第二次走了这个分支）。
     */
    if (same && memo.idx === idx && memo.anim && pill.__anim) {
      observeSegSize(cont, opts);
      return;
    }

    // "从哪来"必须在**落位之前**取，否则拿到的就是新位置了
    var from = null, left = dur, at = now;
    if (same && memo.idx !== idx && memo.w) {
      var live = memo.anim;
      if (live && live.toIdx === idx && (now - live.at) < live.dur) {
        from = { x: live.x, y: live.y, w: live.w, h: live.h };
        left = Math.max(90, live.dur - (now - live.at));
        at = live.at;
      } else {
        from = { x: memo.x, y: memo.y, w: memo.w, h: memo.h };
      }
    }
    /**
     * 整块面板被重画（设置页点一下 → renderSettings）时，胶囊元素是**新的**：
     * 记忆里那次滑动还在进行中，但序号已经被上一次同步写成新值了，
     * 上面那条"序号变了才滑"就判定不出来 —— 结果胶囊直接瞬移到终点。
     * 这里补一条：只要记忆里那次滑动没播完、终点就是当前选中项，
     * 新胶囊也要从它的起点接着把剩余时长播完。
     */
    if (!from && same && memo.anim && memo.anim.toIdx === idx
      && !pill.__anim && (now - memo.anim.at) < memo.anim.dur) {
      from = { x: memo.anim.x, y: memo.anim.y, w: memo.anim.w, h: memo.anim.h };
      left = Math.max(90, memo.anim.dur - (now - memo.anim.at));
      at = memo.anim.at;
    }
    stopPillAnim(pill);
    writePill(pill, g);
    var moved = !!(from && (Math.abs(from.x - g.x) > 0.5 || Math.abs(from.w - g.w) > 0.5));
    segMemos[key] = { count: kids.length, idx: idx, x: g.x, y: g.y, w: g.w, h: g.h, anim: null };
    if (moved && opts.animate !== false) {
      if (slidePill(pill, from, g, left)) {
        segMemos[key].anim = { x: from.x, y: from.y, w: from.w, h: from.h, toIdx: idx, at: at, dur: left };
      }
    } else if (opts.enter) {
      /**
       * 进场 / 重画 / 校准：只播一次统一的"内容浮入"。
       * 和几何补间二选一 —— 两个动画都写 transform，同时播会互相抢。
       */
      enterSegPill(cont, cls);
    }
    observeSegSize(cont, opts);
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
    /**
     * 「今天 / 前一天 / 后一天」：和「本周概览」点日期走同一套过渡 ——
     * 内容按方向滑入、顶栏时钟落定、日期栏滑块滑过去（playTodaySwitch）。
     */
    $('btnPrevDay').addEventListener('click', function () {
      cursorDate = U.addDays(cursorDate, -1);
      AR.Bridge.haptic('light', $('btnPrevDay'));
      renderToday();
      playTodaySwitch(-1);
    });
    $('btnNextDay').addEventListener('click', function () {
      cursorDate = U.addDays(cursorDate, 1);
      AR.Bridge.haptic('light', $('btnNextDay'));
      renderToday();
      playTodaySwitch(1);
    });
    $('btnToday').addEventListener('click', function () {
      var now = new Date();
      var dir = U.sameDay(cursorDate, now) ? 0 : (now.getTime() > cursorDate.getTime() ? 1 : -1);
      cursorDate = now;
      AR.Bridge.haptic('medium', $('btnToday'));
      renderToday();
      playTodaySwitch(dir);
    });
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
      syncDayPillSoon();                 // 转屏 / 窗口尺寸变了，日期滑块跟着重贴
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
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', function (ev) {
        /**
         * 系统自己换深浅色：只有「跟随系统」模式才跟，并且走**顶部整条下扫**的过渡
         * （手动点「浅色 / 深色」是点击处扩散，分流见 themeSwitch）。
         */
        var mode = S.settings.appearance.theme;
        if (mode === 'dark' || mode === 'light') { return; }   // 用户锁定了主题
        themeSwitch(!!(ev && ev.matches), 'system');
      });
    }
    AR.onSystemTheme = applyTheme;

    applyTheme();
    applyMotion();
    applyPerf();
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
    applyAccentInline(dark);
    AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark);
  }

  /**
   * 主题色（以及跟着它走的背景柔光斑）写在 <body> 行内样式上，而不是 :root：
   * tokens.css 里 body[data-theme="dark"] 也定义了 --accent，写在 :root 上会被它盖住
   * —— 这就是之前"暗色模式下换主题色没反应"的原因。行内样式优先级更高，浅色/深色都生效。
   */
  function applyAccentInline(dark) {
    if (dark == null) { dark = document.body.getAttribute('data-theme') === 'dark'; }
    var accent = S.settings.appearance.accent || '#5B8DEF';
    var perf = (AR.Motion && AR.Motion.perfLevel) ? AR.Motion.perfLevel() : 'full';
    var bs = document.body.style;
    bs.setProperty('--accent', accent);
    bs.setProperty('--accent-soft', hexA(accent, 0.14));
    // 流畅模式下光晕是纯开销（大半径 shadow 模糊），压成透明，回到关闭档再恢复
    bs.setProperty('--accent-glow', perf === 'full' ? hexA(accent, 0.22) : 'transparent');
    bs.setProperty('--accent-contrast', '#ffffff');
    // 背景柔光斑跟着主题色走，毛玻璃后面才有对应的色相（暗色下更亮一点）
    bs.setProperty('--blob-a', hexA(accent, dark ? 0.30 : 0.26));
    bs.setProperty('--blob-b', hexA(accent, dark ? 0.20 : 0.16));
  }

  /* ══════════════════════════════════════════════════════════════
     切换主题：整页颜色渐变 + 光效

     以前是 data-theme 一改、整套 CSS 变量同时换值 —— 整页"啪"一下。
     现在分两步：
       ① **颜色令牌连续插值**：把背景 / 玻璃 / 文字 / 描边 / 分隔线 / 光斑
          这十几个令牌在 dur 毫秒内算出中间值，逐帧写回 body 的行内样式。
          于是整页是连续过渡的，不会出现"上面黑了下面还白"。
       ② **一层光**：手动切换以点击处为圆心扩散，系统切换从最顶上一整条往下扫。

     不参与插值的：
       · --blur-*（毛玻璃半径）—— 每帧改它会逼着每层玻璃重算模糊，会卡；
       · --shadow-*（多段颜色，插值意义不大，且本来就是半透明黑）。
     过渡结束时清掉行内令牌，再按当前主题重写一次 --accent 系列，CSS 重新接管。
     ══════════════════════════════════════════════════════════════ */

  /** 参与插值的令牌（顺序无所谓） */
  var THEME_TWEEN_TOKENS = ['--bg-base', '--bg-subtle', '--glass-surface', '--glass-card',
    '--glass-modal', '--glass-border', '--glass-stroke', '--divider',
    '--text-primary', '--text-secondary', '--text-tertiary',
    '--blob-a', '--blob-b', '--blob-c'];

  var themeTween = null;        // { raf, from, to, t0, dur }
  var colorProbe = null;        // 专门用来把 calc()/hex 之类解析成 rgba 的探针元素

  /**
   * 任意 CSS 颜色 → [r,g,b,a]。
   * 走探针 + getComputedStyle：--glass-* 的值里带 calc(.72 * var(--glass-k))，
   * 自己写正则解析不靠谱，交给浏览器算最省心。
   */
  function resolveColor(value) {
    if (!value) { return null; }
    if (!colorProbe) {
      colorProbe = document.createElement('span');
      colorProbe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;';
      document.body.appendChild(colorProbe);
    }
    colorProbe.style.color = '';
    colorProbe.style.color = value;
    var out = '';
    try { out = getComputedStyle(colorProbe).color || ''; } catch (e) { out = ''; }
    var m = /rgba?\(([^)]+)\)/.exec(out);
    if (!m) { return null; }
    var parts = m[1].split(',');
    return [
      parseFloat(parts[0]) || 0,
      parseFloat(parts[1]) || 0,
      parseFloat(parts[2]) || 0,
      parts.length > 3 ? (parts[3] === undefined ? 1 : parseFloat(parts[3])) : 1
    ];
  }

  function mixColor(a, b, t) {
    return 'rgba(' + Math.round(a[0] + (b[0] - a[0]) * t) + ','
      + Math.round(a[1] + (b[1] - a[1]) * t) + ','
      + Math.round(a[2] + (b[2] - a[2]) * t) + ','
      + (a[3] + (b[3] - a[3]) * t).toFixed(3) + ')';
  }

  /** 读当前生效的令牌值：行内优先（过渡中途再切时要接着中间色走），否则取计算值 */
  function readThemeColors() {
    var out = {};
    var cs = getComputedStyle(document.body);
    for (var i = 0; i < THEME_TWEEN_TOKENS.length; i++) {
      var k = THEME_TWEEN_TOKENS[i];
      var inline = document.body.style.getPropertyValue(k);
      var raw = (inline && inline.trim()) || cs.getPropertyValue(k);
      out[k] = resolveColor(raw);
    }
    return out;
  }

  function stopThemeTween() {
    if (themeTween) {
      if (themeTween.raf) { try { cancelAnimationFrame(themeTween.raf); } catch (e) { } }
      themeTween = null;
    }
    clearInlineThemeTokens();
  }

  /** 清掉逐帧插值留下的行内令牌（含 --blob-a/b，它们本该由 applyAccentInline 管） */
  function clearInlineThemeTokens() {
    for (var j = 0; j < THEME_TWEEN_TOKENS.length; j++) {
      document.body.style.removeProperty(THEME_TWEEN_TOKENS[j]);
    }
  }

  /* ── 主题揭示层（v0.3.7 · 第 2 版：旧主题快照）────────────────

     走过的两条弯路，记在这儿免得再踩：
       ① 最早那层"柔光"用 plus-lighter 叠近黑色 / multiply 叠白色 —— 数学上恒等，
          等于什么都没画，手动切换时完全看不到光效；
       ② 改成"旧主题底色的半透明膜"后倒是看得见了，但那层膜盖在**已经切成新主题**
          的页面上，没铺到的区域就成了"新内容隔着一层灰纱" —— 用户说的"被切成灰色"。

     现在：**旧主题快照**。
       ① 点按瞬间把当前页面整份 cloneNode 出来，钉上"旧主题"的令牌，盖在最上层；
       ② 真实页面同时切到新主题（被快照盖着，看不见）；
       ③ 在快照上用 mask 从点击处开洞：洞内是清清楚楚的新主题，
          洞外是清清楚楚的旧主题 —— 不再是灰纱，而是"新主题把旧画面吃掉"；
       ④ 铺满后撤掉快照。

     两个关键点（都实测过）：
       · 克隆整页在模拟器上只要 0.5～0.9ms，可以忽略；
       · 快照层加了 mask 会自己形成 backdrop root，它内部的毛玻璃模糊的是
         "快照自己那层的底色"，不会串到下面的新主题（否则快照的玻璃会偏色）。

     退化路径：不支持 mask / 克隆失败 / 页面节点太多 → 直接走"整页颜色渐变"
     （不铺任何膜，绝不会再出现灰色遮罩）。 */

  /** 跟主题有关、必须钉在快照上的变量（含阴影这种没法插值的字符串） */
  var SNAPSHOT_VARS = ['--bg-base', '--bg-subtle', '--glass-surface', '--glass-card', '--glass-modal',
    '--glass-border', '--glass-stroke', '--shadow-card', '--shadow-panel', '--shadow-modal',
    '--text-primary', '--text-secondary', '--text-tertiary', '--divider',
    '--accent', '--accent-soft', '--accent-glow', '--accent-contrast',
    '--blob-a', '--blob-b', '--blob-c'];

  var themeInk = null;      // 正在扩散的"墨滴"层
  var themeSnap = null;     // 铺在下面的旧主题快照
  var themeInkRaf = 0;
  var SPREAD_CORE = 0.72;   // 墨滴里"完全不透明"的部分占半径的比例（剩下 28% 是羽化）

  function stopThemeInk() {
    if (themeInkRaf) { try { cancelAnimationFrame(themeInkRaf); } catch (e) { } themeInkRaf = 0; }
    if (themeInk && themeInk.parentNode) { themeInk.parentNode.removeChild(themeInk); }
    if (themeSnap && themeSnap.parentNode) { themeSnap.parentNode.removeChild(themeSnap); }
    themeInk = null;
    themeSnap = null;
  }

  /** 把"当前生效"的主题变量原样读出来（切换之前调） */
  function readThemeVars() {
    var cs = getComputedStyle(document.body);
    var out = {};
    for (var i = 0; i < SNAPSHOT_VARS.length; i++) {
      var k = SNAPSHOT_VARS[i];
      var v = document.body.style.getPropertyValue(k) || cs.getPropertyValue(k) || '';
      out[k] = String(v).trim();
    }
    return out;
  }

  /**
   * 造一层"旧主题快照"。失败（或页面太大）返回 null，交给兜底。
   * 除了 DOM，还要把 cloneNode 带不走的东西补上：滚动位置、输入框内容、勾选状态。
   */
  function buildThemeSnapshot(oldDark, oldVars) {
    var kids = document.body.children;
    var src = [], nodes = 0, i;
    for (i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.classList && (n.classList.contains('theme-snap') || n.classList.contains('theme-ink'))) { continue; }
      src.push(n);
      nodes += 1 + (n.querySelectorAll ? n.querySelectorAll('*').length : 0);
    }
    if (!src.length || nodes > 1600) { return null; }   // 页面实在太大就别克隆了

    var wrap = document.createElement('div');
    wrap.className = 'theme-snap';
    wrap.setAttribute('data-theme', oldDark ? 'dark' : 'light');
    var attrs = ['data-platform', 'data-preset', 'data-glass', 'data-degraded', 'data-focus'];
    for (i = 0; i < attrs.length; i++) {
      var av = document.body.getAttribute(attrs[i]);
      if (av != null) { wrap.setAttribute(attrs[i], av); }
    }
    for (i = 0; i < SNAPSHOT_VARS.length; i++) {
      var key = SNAPSHOT_VARS[i];
      if (oldVars[key]) { wrap.style.setProperty(key, oldVars[key]); }
    }
    // 快照自己的底色：里面那些毛玻璃就是拿它当"背景"去模糊的
    wrap.style.background = 'var(--bg-base)';

    var realScrolls = document.querySelectorAll('.scroll');
    var realFields = document.querySelectorAll('input, textarea, select');
    try {
      for (i = 0; i < src.length; i++) { wrap.appendChild(src[i].cloneNode(true)); }
    } catch (e) { return null; }

    var snapScrolls = wrap.querySelectorAll('.scroll');
    for (i = 0; i < realScrolls.length && i < snapScrolls.length; i++) {
      snapScrolls[i].scrollTop = realScrolls[i].scrollTop;
      snapScrolls[i].scrollLeft = realScrolls[i].scrollLeft;
    }
    var snapFields = wrap.querySelectorAll('input, textarea, select');
    for (i = 0; i < realFields.length && i < snapFields.length; i++) {
      var rf = realFields[i], sf = snapFields[i];
      try {
        if (rf.tagName === 'SELECT') { sf.value = rf.value; }
        else if (rf.type === 'checkbox' || rf.type === 'radio') { sf.checked = rf.checked; }
        else { sf.value = rf.value; }
      } catch (e2) { /* 个别类型不给写就算了 */ }
    }
    document.body.appendChild(wrap);
    return wrap;
  }

  /**
   * 造"墨滴"层：一块**新主题底色**的圆（或下扫用的一条），
   * 边缘靠一段渐变羽化，中心是完全不透明的实色。
   *
   * 关键点：它的生长只用 `transform: scale()` + `opacity` —— 这两个属性浏览器
   * 交给合成器直接缩放/调透明度，**不重新光栅化**。
   * 上一版每帧改 `mask`，浏览器每帧都要重新生成一张全屏遮罩，
   * 手机上就是"看着卡、掉帧"的来源（实测主线程帧间隔 17ms 完全正常，
   * 说明时间都花在合成/光栅那边，不在 JS）。
   */
  function makeSpreadLayer(kind, dark) {
    var w = window.innerWidth, h = window.innerHeight;
    var base = themeBaseHex(dark);
    var node = document.createElement('div');
    node.className = 'theme-spread';
    var vertical = (kind === 'sweepTop');
    if (vertical) {
      node.style.left = '0px';
      node.style.top = '0px';
      node.style.width = w + 'px';
      node.style.height = Math.round(h / SPREAD_CORE) + 'px';
      node.style.transformOrigin = '50% 0%';
      node.style.background = 'linear-gradient(to bottom, ' + hexA(base, 1) + ' 0%, '
        + hexA(base, 1) + ' ' + Math.round(SPREAD_CORE * 100) + '%, ' + hexA(base, 0) + ' 100%)';
    } else {
      var hasPointer = !!(lastPointer && (lastPointer.x || lastPointer.y));
      var px = hasPointer ? lastPointer.x : Math.round(w / 2);
      var py = hasPointer ? lastPointer.y : Math.round(h / 2);
      var dx = Math.max(px, w - px), dy = Math.max(py, h - py);
      var need = Math.sqrt(dx * dx + dy * dy);
      var s = Math.ceil(need / SPREAD_CORE);
      node.style.left = px + 'px';
      node.style.top = py + 'px';
      node.style.width = (s * 2) + 'px';
      node.style.height = (s * 2) + 'px';
      node.style.transformOrigin = '50% 50%';
      node.style.background = 'radial-gradient(circle closest-side, ' + hexA(base, 1) + ' 0%, '
        + hexA(base, 1) + ' ' + Math.round(SPREAD_CORE * 100) + '%, ' + hexA(base, 0) + ' 100%)';
    }
    node.style.opacity = '0';
    return node;
  }

  /**
   * 底色 → hex。造墨滴时 body 已经切到**目标主题**了，所以这里取到的就是目标色；
   * 万一解析不出来（极老的 WebView）再退回黑白常量。
   */
  function themeBaseHex(dark) {
    var c = resolveColor(getComputedStyle(document.body).getPropertyValue('--bg-base').trim());
    if (!c) { return dark ? '#0e1116' : '#ffffff'; }
    return '#' + [c[0], c[1], c[2]].map(function (n) {
      var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }

  /**
   * 扩散：线性推进（用户要的），墨滴的**不透明度随扩散增加**（0.35 → 1），
   * 铺满后撤掉旧主题快照、墨滴再淡出 140ms，露出已经是新主题的真实页面。
   * 每帧只写 transform / opacity 两个合成器属性。
   */
  function runSpread(ink, snap, kind, dur, st, onDone) {
    var vertical = (kind === 'sweepTop');
    var t0 = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / dur);
      ink.style.transform = vertical
        ? ('scaleY(' + p + ')')
        : ('translate3d(-50%,-50%,0) scale(' + p + ')');
      ink.style.opacity = String(Math.round((0.35 + 0.65 * p) * 100) / 100);
      if (p < 1) { themeInkRaf = requestAnimationFrame(frame); return; }
      themeInkRaf = 0;
      // 铺满了：快照此刻被完全盖住，撤掉它不会有任何可见变化
      if (snap && snap.parentNode) { snap.parentNode.removeChild(snap); themeSnap = null; }
      fadeOutLayer(ink, 140, onDone);
    }
    frame(t0);
  }

  /** 整层淡出（cross 与收尾共用） */
  function fadeOutLayer(layer, ms, onDone) {
    if (!layer) { if (onDone) { onDone(); } return; }
    if (!layer.animate) { setTimeout(onDone, ms); return; }
    var a = layer.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: ms, easing: 'linear', fill: 'forwards' });
    if (a.finished && a.finished.then) {
      a.finished.then(function () { onDone(); }).catch(function () { onDone(); });
    } else if (a.onfinish !== undefined) {
      a.onfinish = function () { onDone(); };
    } else {
      setTimeout(onDone, ms + 20);
    }
  }


  /**
   * 「只渐变色」：保留原来那套"整页颜色令牌逐帧插值"。
   * 最安静的一种，没有几何光效，但整页颜色是连续过渡的。
   */
  function playColorTween(dark, dur, st) {
    var from = readThemeColors();
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    applyAccentInline(dark);
    var to = readThemeColors();

    var t0 = performance.now();
    function paint(e) {
      for (var i = 0; i < THEME_TWEEN_TOKENS.length; i++) {
        var kk = THEME_TWEEN_TOKENS[i];
        if (!from[kk] || !to[kk]) { continue; }
        document.body.style.setProperty(kk, mixColor(from[kk], to[kk], e));
      }
    }
    function frame(now) {
      if (!themeTween || themeTween.frame !== frame) { return; }
      var p = Math.min(1, (now - t0) / dur);
      paint(AR.Motion && AR.Motion.cubicAt ? AR.Motion.cubicAt(st && st.ease, p) : p);
      if (p < 1) { themeTween.raf = requestAnimationFrame(frame); return; }
      clearInlineThemeTokens();
      applyAccentInline(dark);
      themeTween = null;
    }
    themeTween = { raf: 0, frame: frame };
    paint(0);
    themeTween.raf = requestAnimationFrame(frame);
  }

  /**
   * 切主题。
   *   dark  —— 目标是不是深色
   *   mode  —— 'click'（用户手动点）/ 'system'（跟随系统自己变）/ 'boot'（启动、导入等，直接落位）
   */
  function themeSwitch(dark, mode) {
    var nowDark = document.body.getAttribute('data-theme') === 'dark';
    if (!!dark === nowDark) {          // 没变化：只补一次系统条，不播动画
      AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark);
      return;
    }
    /**
     * 流畅模式快路径：墨滴扩散 / 顶部下扫都要"整页快照 + 大面积光效"，
     * 标准档砍掉光效只留整页颜色渐变（更短），深度档直接落位。
     */
    var perf = (AR.Motion && AR.Motion.perfLevel) ? AR.Motion.perfLevel() : 'full';
    if (perf !== 'full' && mode !== 'boot') {
      stopThemeTween();
      stopThemeInk();
      if (perf === 'lite') {
        // 只渐变色：没有快照、没有墨滴，逐帧只写颜色令牌（旧色要靠它在内部先读）
        playColorTween(dark, Math.round(260 / motionSpeed()), { ease: 'soft' });
      } else {
        document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
        applyAccentInline(dark);
      }
      AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark);
      return;
    }
    var st = AR.Motion ? AR.Motion.get('themeSwitch') : null;
    var k = st && st.k;
    /**
     * 「自动」按来源分流：手点 = 点击处扩散，系统切换 = 顶部整条下扫。
     * 开发者模式里手动选了别的样式就一律用那个（不再分流）。
     */
    if (!k || k === 'auto') {
      k = (mode === 'system') ? 'sweepTop' : 'ripple';
      var picked = AR.Motion && AR.Motion.styleOf ? AR.Motion.styleOf('themeSwitch', k) : null;
      if (picked) { st = picked; }
    }
    var dur = st ? Math.round((st.dur || 0) / motionSpeed()) : 0;
    if (!st || !dur || mode === 'boot') {
      stopThemeTween();
      stopThemeInk();
      document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
      applyAccentInline(dark);
      AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark);
      return;
    }

    if (k === 'colorOnly') {
      stopThemeInk();
      playColorTween(dark, dur, st);
    } else {
      stopThemeTween();
      stopThemeInk();
      /**
       * 旧主题的一切都得在**切换之前**取：令牌（给快照钉色）+ 一份整页快照。
       * 快照失败（克隆异常 / 页面过大 / 不支持 mask）就回落到"整页颜色渐变"——
       * 宁可不花哨，也绝不能又出现一层灰色遮罩。
       */
      var oldVars = readThemeVars();
      var snap = buildThemeSnapshot(!dark, oldVars);
      if (!snap) {
        playColorTween(dark, dur, st);
      } else {
        // 立刻落位到目标主题 —— 这一帧被快照盖着，用户看不到"啪"
        document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
        applyAccentInline(dark);
        themeSnap = snap;
        if (k === 'cross') {
          // 交叉淡入：整层旧画面淡出，露出下面的新主题（纯 opacity，最轻）
          fadeOutLayer(snap, dur, function () { stopThemeInk(); });
        } else {
          themeInk = makeSpreadLayer(k, dark);
          document.body.appendChild(themeInk);
          runSpread(themeInk, snap, k, dur, st, function () { stopThemeInk(); });
        }
      }
    }

    // 系统条没法跟着插值：走到一半再切，两头都留余量
    setTimeout(function () {
      if (themeTween || themeInk) { AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark); }
    }, Math.round(dur * 0.5));
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

  /* ══════════════════════════════════════════════════════════════
     自绘下拉（替换原生 <select>）

     原生 select 在 Android 上弹的是**系统自己的窗口**：ColorOS / MIUI / 原生
     各长各的样，字体、圆角、选中样式和应用完全对不上，也不跟随"质感模糊效果"
     设置。所以这里自己画一个：
       · 毛玻璃 / 描边 / 阴影全部用 CSS 变量（和别的弹窗同一套）；
       · 进出场走 AR.Motion 的 modal 场景 —— 和位置 / 时间 / 老师 / 备注弹窗
         完全一样，开发者模式里换动画样式它们一起变；
       · 点遮罩、点 ✕、按 Esc 都能关。
     ══════════════════════════════════════════════════════════════ */

  /**
   * 打开一个选择器。
   *   opts.title / opts.sub   标题与说明
   *   opts.options            [{ v: 值, t: 显示文字, sub: 次要说明 }]
   *   opts.value              当前值（字符串比较）
   *   opts.onPick(v, o)       选中回调
   */
  function openPicker(opts) {
    opts = opts || {};
    var options = opts.options || [];
    var value = opts.value == null ? '' : String(opts.value);
    // 只允许存在一个选择浮层：重复打开时先把旧的收掉
    var olds = document.querySelectorAll('.pk-root');
    for (var oi = 0; oi < olds.length; oi++) {
      if (olds[oi].parentNode) { olds[oi].parentNode.removeChild(olds[oi]); }
    }

    var list = el('<div class="pk-list"></div>');
    for (var i = 0; i < options.length; i++) {
      (function (o) {
        var on = String(o.v) === value;
        var label = o.t == null ? String(o.v) : String(o.t);
        var b = el('<button class="pk-opt' + (on ? ' on' : '') + '" type="button">'
          + '<span class="pk-txt">' + U.escapeHtml(label)
          + (o.sub ? '<em class="pk-sub">' + U.escapeHtml(o.sub) + '</em>' : '')
          + '</span><span class="pk-tick" aria-hidden="true">✓</span></button>');
        b.addEventListener('click', function () {
          AR.Bridge.haptic('light', b);
          closePicker();
          if (opts.onPick) { opts.onPick(o.v, o); }
        });
        list.appendChild(b);
      })(options[i]);
    }

    /**
     * 独立浮层（不走 openModal 那张单例卡片）：
     * 课程编辑器本身就是主弹窗，选择器如果用同一张卡片，选完编辑器就被顶掉了
     * —— 和取色器同一个理由，见 openColorPicker 里的注释。
     */
    var root = el('<div class="pk-root"></div>');
    var scrim = el('<div class="modal-scrim"></div>');
    var card = el('<div class="modal-card pk-card"></div>');
    var head = el('<div class="modal-head"><div><h3 class="modal-title">'
      + U.escapeHtml(opts.title || '请选择') + '</h3>'
      + (opts.sub ? '<p class="modal-sub">' + U.escapeHtml(opts.sub) + '</p>' : '')
      + '</div><button class="modal-close" type="button">✕</button></div>');
    var wrap = el('<div class="modal-body"></div>');
    wrap.appendChild(list);
    card.appendChild(head);
    card.appendChild(wrap);
    root.appendChild(scrim);
    root.appendChild(card);
    document.body.appendChild(root);

    var closed = false;
    var outMs = 0;
    function onKey(ev) { if (ev.key === 'Escape' || ev.keyCode === 27) { closePicker(); } }
    function closePicker() {
      if (closed) { return; }
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('open');
      popIn(card, 'out');
      var m = AR.Motion ? AR.Motion.dir('modal', 'out') : null;
      outMs = Math.round((((m && m.dur) || 240) / motionSpeed()) + 40);
      setTimeout(function () {
        if (root.parentNode) { root.parentNode.removeChild(root); }
      }, outMs);
    }
    head.querySelector('.modal-close').addEventListener('click', closePicker);
    scrim.addEventListener('click', closePicker);
    card.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('keydown', onKey, true);

    /**
     * 进场：和主弹窗同一套动画（popIn 读的就是 AR.Motion 的 modal 场景），
     * 遮罩单独淡入 —— 主弹窗那边也是这么分工的。
     */
    popIn(card, 'in');
    setTimeout(function () { if (!closed) { root.classList.add('open'); } }, 10);

    // 当前项滚进视野（只滚列表自己，不动背后那层页面）
    var cur = list.querySelector('.pk-opt.on');
    if (cur) {
      try {
        var lr = list.getBoundingClientRect();
        var cr = cur.getBoundingClientRect();
        if (cr.top < lr.top || cr.bottom > lr.bottom) {
          list.scrollTop += (cr.top - lr.top) - (lr.height - cr.height) / 2;
        }
      } catch (e) { /* 忽略：拿不到 rect 就不滚动 */ }
    }
    return { close: closePicker };
  }

  /**
   * 把"当前值 → 显示文字"画到触发器上。
   * 找不到匹配项时才用占位文字（空值也可能有对应项，比如"自动识别"）。
   */
  function paintPickerTrigger(b) {
    if (!b || !b.__opts) { return b; }
    var text = '';
    for (var i = 0; i < b.__opts.length; i++) {
      if (String(b.__opts[i].v) === String(b.value)) {
        text = b.__opts[i].t == null ? String(b.__opts[i].v) : String(b.__opts[i].t);
        break;
      }
    }
    b.classList[text ? 'remove' : 'add']('is-empty');
    b.innerHTML = '<span class="pick-txt">' + U.escapeHtml(text || b.__placeholder || '请选择')
      + '</span><span class="pick-arrow" aria-hidden="true">▾</span>';
    if (b.__syncWeeks) { b.__syncWeeks(); }
    return b;
  }

  /**
   * 写值 + 派发一次 change。
   * 触发器是 <button>，但 .value 和原生 <select> 一样能读能写，
   * 所以"监听 change、读 el.value"的老代码一行都不用改。
   */
  function setPickerValue(b, v, silent) {
    if (!b) { return; }
    b.value = (v == null ? '' : String(v));
    paintPickerTrigger(b);
    if (silent) { return; }
    try {
      b.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      try {
        var ev = document.createEvent('HTMLEvents');
        ev.initEvent('change', true, false);
        b.dispatchEvent(ev);
      } catch (e2) { /* 派发不了就算了，值已经写进去了 */ }
    }
  }

  /** 换一批选项（手动添加页 / 冲突修正里的星期、节次都是动态填的） */
  function setPickerOptions(b, options, keepValue) {
    if (!b) { return; }
    b.__opts = (options || []).slice();
    if (!keepValue) {
      var hit = false;
      for (var i = 0; i < b.__opts.length; i++) {
        if (String(b.__opts[i].v) === String(b.value)) { hit = true; break; }
      }
      if (!hit && b.__opts.length) { b.value = String(b.__opts[0].v); }
    }
    paintPickerTrigger(b);
  }

  /**
   * 生成一个"看起来像输入框、点开是自绘选择器"的下拉触发器。
   *   cfg: { id, value, options, title, sub, placeholder, always, onPick }
   * onPick(v, o, el) 在每次选择后触发；always=true 时连"选了同一项"也触发。
   */
  function pickerTrigger(cfg) {
    cfg = cfg || {};
    var b = el('<button class="input pick-trigger" type="button"></button>');
    if (cfg.id) { b.id = cfg.id; }
    if (cfg.cls) { b.className += ' ' + cfg.cls; }
    b.__opts = (cfg.options || []).slice();
    b.__placeholder = cfg.placeholder || '请选择';
    b.__syncWeeks = cfg.syncWeeks || null;
    b.value = cfg.value == null ? '' : String(cfg.value);
    paintPickerTrigger(b);
    b.addEventListener('click', function () {
      openPicker({
        title: cfg.title || '', sub: cfg.sub, options: b.__opts, value: b.value,
        onPick: function (v, o) {
          if (!cfg.always && String(v) === String(b.value)) { return; }
          setPickerValue(b, v);
          if (cfg.onPick) { cfg.onPick(v, o, b); }
        }
      });
    });
    return b;
  }

  function applyGlass() {
    var lvl = S.settings.appearance.glassLevel || 'medium';
    var degraded = AR.Bridge.sdkInt && AR.Bridge.sdkInt() > 0 && AR.Bridge.sdkInt() < 31;
    var perf = (AR.Motion && AR.Motion.perfLevel) ? AR.Motion.perfLevel() : 'full';
    document.body.setAttribute('data-degraded', degraded && lvl !== 'off' ? 'on' : 'off');
    document.body.setAttribute('data-glass', perf !== 'full' ? 'off' : lvl);
    AR.Bridge.setBackdrop(lvl !== 'off' && perf === 'full');
  }

  /**
   * 流畅模式：body 上挂 data-perf="lite|min"（关闭档移除属性）。
   * CSS 见 app.css 末尾「流畅模式」一节；质感模糊 / 光斑 / 光晕一起降。
   * 切换后立刻重挂，并顺手把当前正在补间的主题令牌收掉，避免残留行内样式。
   */
  function applyPerf() {
    var perf = (AR.Motion && AR.Motion.perfLevel) ? AR.Motion.perfLevel() : 'full';
    if (perf === 'full') { document.body.removeAttribute('data-perf'); }
    else { document.body.setAttribute('data-perf', perf); }
    stopThemeTween();
    stopThemeInk();
    applyGlass();
    applyAccentInline();
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
    themeSwitch: themeSwitch,
    applyGlass: applyGlass,
    applyPerf: applyPerf,
    applyMotion: applyMotion,
    applyLayout: applyLayout,
    setPreset: setPreset,
    setSize: setSize,
    setExpanded: setExpanded,
    expanded: function () { return Layout.expanded; },
    syncSegPill: syncSegPill,
    syncSegments: syncSegments,
    enhanceSegmented: enhanceSegmented,
    flashButton: flashButton,
    enterRise: enterRise,          // 开发者模式的「页面入场」试放
    fadeInList: fadeInList,        // 开发者模式的「列表入场」试放
    openColorPicker: openColorPicker,
    openPicker: openPicker,
    pickerTrigger: pickerTrigger,
    paintPickerTrigger: paintPickerTrigger,
    setPickerValue: setPickerValue,
    setPickerOptions: setPickerOptions,
    openTaskLog: openTaskLog,
    openLongTaskEntry: openLongTaskEntry,
    openLongTaskEdit: openLongTaskEdit,
    refreshHomeworkPanels: refreshHomeworkPanels,
    refreshHomework: refreshHomework,
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
