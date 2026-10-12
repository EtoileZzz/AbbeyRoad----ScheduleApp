/* ──────────────────────────────────────────────────────────────
   Abbey Road · 桌面卡片数据

   网页是唯一真源：这里把「今天 / 本周 / 下一节课」渲染成一份快照，
   交给原生外壳（Android 桌面小组件读它；Windows 端可以忽略）。
   卡片本身不做任何业务计算，所以两端永远一致。
   ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var AR = window.AR || (window.AR = {});
  var timer = null;

  function plain(t) { return /^\d{1,2}:\d{2}$/.test(t || '') ? t : ''; }

  /**
   * 0.4.2：每种尺寸卡片的「功能显示预设」。
   * 全部在网页侧决定 payload 内容 —— 原生渲染器不用改，卡片立刻按预设变样。
   *   head  今日头 4×1：A 节数 / B 下一节倒计时 / C 今日剩余节数
   *   next  下一节课 2×2：A 课名·时间·地点 / B 加周次 / C 极简课名·倒计时
   *   today 今日清单 4×2：A 全部 ≤4 条 / B 只显示没上完的 / C 只显示时间+课名
   *   week  本周迷你课表：A 周一到周五 / B 含周末 / C 今天起两天
   */
  function presets() {
    var S = AR.Store.get();
    S.settings.widgets = S.settings.widgets || {};
    return S.settings.widgets.presets || (S.settings.widgets.presets = {});
  }
  function pre(key, def) { return presets()[key] || def; }

  function rangeText(item) {
    var a = plain(item.start), b = plain(item.end);
    if (a && b) { return a + ' – ' + b; }
    return item.periodLabel || '时间待定';
  }

  function buildPayload() {
    var U = AR.Util;
    var sem = AR.Store.currentSemester();
    var now = new Date();
    var weekday = U.WEEKDAY_NAMES[U.weekdayOf(now)];
    var weekNo = sem ? Math.max(1, AR.Schedule.weekNumber(now, sem)) : 0;
    var items = sem ? AR.Schedule.dayItems(now, sem) : [];

    var payload = {
      v: AR.Const.APP_VERSION,
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + weekday,
      weekNo: weekNo,
      weekRange: '',
      todayTitle: '今天 · ' + weekday,
      todaySub: items.length ? (items.length + ' 节课 · ' + rangeText(items[0])) : '今天没有课',
      todayBadge: items.length ? (plain(items[0].start) || items[0].periodLabel || '—') : '休息',
      todayIdx: U.weekdayOf(now),
      dates: [],
      today: [],
      week: [],
      weekTotalText: '',
      nextLabel: '下一节课',
      nextIn: '',
      nextName: '',
      nextTime: '',
      nextPlace: ''
    };

    /* 今日清单（卡片最多画 4 条）；_endMin 供「只显示没上完的」预设过滤 */
    var todayMode = pre('today', 'A');
    var nowMin = now.getHours() * 60 + now.getMinutes();
    for (var i = 0; i < items.length && i < 4; i++) {
      var it = items[i];
      if (todayMode === 'B' && typeof it.endMin === 'number' && it.endMin <= nowMin) { continue; }
      payload.today.push({
        time: rangeText(it) + (it.periodLabel ? ' · ' + it.periodLabel : ''),
        name: it.course.name,
        place: todayMode === 'C' ? '' : (it.location ? it.location.raw : ''),
        color: it.color || '#5B8DEF'
      });
    }

    /* 本周：迷你课表色块 + 日期行 */
    if (sem && weekNo) {
      var monday = U.addDays(U.mondayOf(U.parseDateKey(sem.startDate)), (weekNo - 1) * 7);
      var sunday = U.addDays(monday, 6);
      payload.weekRange = (monday.getMonth() + 1) + '月' + monday.getDate() + '日 – '
        + (sunday.getMonth() + 1) + '月' + sunday.getDate() + '日';
      var total = 0;
      var weekMode = pre('week', 'A');
      var wd = U.weekdayOf(now);
      var dayFrom = 1, dayTo = 7;
      if (weekMode === 'A') { dayTo = 5; }
      else if (weekMode === 'C') { dayFrom = wd; dayTo = Math.min(7, wd + 1); }
      for (var d = 1; d <= 7; d++) {
        var dd = U.addDays(monday, d - 1);
        payload.dates.push(String(dd.getDate()));
        if (d < dayFrom || d > dayTo) { continue; }   // 日期行仍填满 7 列，保证列对齐
        var list = AR.Schedule.weekItems(weekNo, d);
        total += list.length;
        for (var k = 0; k < list.length; k++) {
          payload.week.push({
            d: d,
            s: AR.UI.itemStartPeriod(list[k]),
            e: AR.UI.itemEndPeriod(list[k]),
            color: list[k].color || '#5B8DEF',
            name: list[k].course.name
          });
        }
      }
      payload.weekTotalText = total + ' 节 · 共 ' + (sem.weekCount || 20) + ' 周';
    }

    /* 下一节课（含进行中） */
    try {
      var ongoing = AR.Schedule.ongoingItem(now);
      var next = AR.Schedule.nextItem(now);
      var target = ongoing ? { item: ongoing, day: U.startOfDay(now), offsetDays: 0, ongoing: true } : next;
      if (target) {
        var item = target.item;
        payload.nextLabel = target.ongoing ? '正在上课' : '下一节课';
        payload.nextName = item.course.name;
        payload.nextTime = rangeText(item) + (item.periodLabel ? ' · ' + item.periodLabel : '');
        payload.nextPlace = item.location ? item.location.raw : '';
        if (target.ongoing) {
          payload.nextIn = item.end ? ('到 ' + plain(item.end)) : '';
        } else if (target.offsetDays === 0) {
          var mins = item.startMin - (now.getHours() * 60 + now.getMinutes());
          payload.nextIn = mins > 0 ? (mins < 60 ? (mins + ' 分钟后') : (Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分后')) : '';
        } else if (target.offsetDays === 1) {
          payload.nextIn = '明天';
        } else {
          payload.nextIn = target.offsetDays + ' 天后';
        }
      }
    } catch (e) { }

    /* ── 预设收尾（放在最后：此时 items / 下一节课都已算好）── */
    var headMode = pre('head', 'A');
    if (headMode === 'B') {
      payload.todayBadge = payload.nextIn || '今天没课';
      payload.todaySub = payload.nextName || '最近没有安排';
    } else if (headMode === 'C') {
      var left = 0;
      for (var li = 0; li < items.length; li++) {
        if (typeof items[li].endMin !== 'number' || items[li].endMin > nowMin) { left++; }
      }
      payload.todayBadge = items.length ? ('还剩 ' + left + ' 节') : '休息';
      payload.todaySub = '共 ' + items.length + ' 节';
    }
    var nextMode = pre('next', 'A');
    if (nextMode === 'B' && payload.nextName) {
      payload.nextPlace = payload.nextPlace ? (payload.nextPlace + ' · 第 ' + weekNo + ' 周') : ('第 ' + weekNo + ' 周');
    } else if (nextMode === 'C' && payload.nextName) {
      payload.nextTime = payload.nextIn || payload.nextTime;
      payload.nextPlace = '';
    }

    return payload;
  }

  function sync(immediate) {
    if (timer) { clearTimeout(timer); timer = null; }
    var run = function () {
      timer = null;
      try {
        if (!AR.Bridge || !AR.Bridge.syncWidget) { return; }
        AR.Bridge.syncWidget(JSON.stringify(buildPayload()));
      } catch (e) { }
    };
    if (immediate) { run(); return; }
    timer = setTimeout(run, 400);
  }

  AR.WidgetData = { build: buildPayload, sync: sync };
})();
