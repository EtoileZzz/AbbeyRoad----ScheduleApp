/* ──────────────────────────────────────────────────────────────
   Abbey Road · 核心逻辑（无 UI 依赖，可单独测试）
   包含：工具函数 / 数据仓库 / 课表计算 / 地点解析 / 固定提示词
   规则与《Abbey Road 产品与架构规划 v0.2.0》一致。
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

var APP_VERSION = '0.3.0';
  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = 'abbeyroad.state.v1';
  var LAYOUT_KEY = 'abbeyroad.layout.v1';

  /* ── 工具 ─────────────────────────────────────────────────── */

  function uid() {
    var t = Date.now().toString(36).toUpperCase();
    var r = '';
    var chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (var i = 0; i < 10; i++) { r += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return t + r;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function timeKey(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  function parseDateKey(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) { return null; }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function addMinutes(d, n) { return new Date(d.getTime() + n * 60000); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  /** 相差几天（只按自然日算，忽略时分秒；b 在未来为正数） */
  function daysBetween(a, b) {
    return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
  }

  /** 周一 = 1 … 周日 = 7 */
  function weekdayOf(d) { return ((d.getDay() + 6) % 7) + 1; }

  /** 取某天所在周的周一 */
  function mondayOf(d) {
    var x = startOfDay(d);
    return addDays(x, 1 - weekdayOf(x));
  }

  function hmToMinutes(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec((hm || '').trim());
    if (!m) { return null; }
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function minutesToHM(min) {
    var m = ((min % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) { clearTimeout(t); }
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }

  var WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /* ── 常量 ─────────────────────────────────────────────────── */

  var PALETTE = [
    { key: 'blue',   hex: '#5B8DEF', name: '雾蓝' },
    { key: 'green',  hex: '#2FB37A', name: '苔绿' },
    { key: 'orange', hex: '#E8843C', name: '暖橙' },
    { key: 'purple', hex: '#7C6EE6', name: '紫藤' },
    { key: 'red',    hex: '#E5484D', name: '砖红' },
    { key: 'teal',   hex: '#1FA8A0', name: '青碧' },
    { key: 'amber',  hex: '#D9A22B', name: '琥珀' },
    { key: 'pink',   hex: '#D9649B', name: '藕粉' },
    { key: 'indigo', hex: '#4A6BE0', name: '靛蓝' },
    { key: 'lime',   hex: '#6FA32B', name: '竹青' },
    { key: 'brown',  hex: '#9A6B4F', name: '栗棕' },
    { key: 'slate',  hex: '#5A6072', name: '石墨' }
  ];

  function colorHex(key) {
    // 支持直接存自定义颜色（导入时由 AI 从原图识别出来的 #RRGGBB）
    if (typeof key === 'string' && key.charAt(0) === '#') { return key; }
    for (var i = 0; i < PALETTE.length; i++) { if (PALETTE[i].key === key) { return PALETTE[i].hex; } }
    return PALETTE[0].hex;
  }

  /* ── 特殊事件（考试 / 讲座 / 活动）：不属于课表节次，单独一张表 ── */
  var EVENT_TYPES = [
    { key: 'exam', label: '考试', hex: '#E5484D', mark: '考' },
    { key: 'lecture', label: '讲座', hex: '#7C6EE6', mark: '讲' },
    { key: 'activity', label: '活动', hex: '#1FA8A0', mark: '活' },
    { key: 'other', label: '其他', hex: '#D9A22B', mark: '事' }
  ];

  function eventType(key) {
    for (var i = 0; i < EVENT_TYPES.length; i++) { if (EVENT_TYPES[i].key === key) { return EVENT_TYPES[i]; } }
    return EVENT_TYPES[3];
  }

  /** 默认 12 节作息（可在设置里改） */
  var OLD_PERIOD_TIMES = [
    ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
    ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'],
    ['19:00', '19:45'], ['19:55', '20:40'], ['20:50', '21:35'], ['21:45', '22:30']
  ];
  function defaultPeriodTimes() {
    return [
      ['08:00', '08:45'], ['08:50', '09:35'], ['10:00', '10:45'], ['10:50', '11:35'],
      ['13:30', '14:15'], ['14:20', '15:05'], ['15:30', '16:15'], ['16:20', '17:05'],
      ['18:00', '18:45'], ['18:50', '19:35'], ['19:40', '20:25'], ['20:30', '22:00']
    ];
  }

  function makePeriods(semesterId) {
    var times = defaultPeriodTimes();
    var out = [];
    for (var i = 0; i < times.length; i++) {
      out.push({
        id: uid(), semesterId: semesterId, index: i + 1,
        label: '第' + (i + 1) + '节', start: times[i][0], end: times[i][1],
        updatedAt: new Date().toISOString()
      });
    }
    return out;
  }

  /** 现有节次表是不是「上一版默认作息」（是的话升级时可以安全换成新默认） */
  function isOldDefaultPeriods(periods) {
    if (!periods || periods.length !== OLD_PERIOD_TIMES.length) { return false; }
    var sorted = periods.slice().sort(function (a, b) { return a.index - b.index; });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].index !== i + 1) { return false; }
      if (sorted[i].start !== OLD_PERIOD_TIMES[i][0]) { return false; }
      if (sorted[i].end !== OLD_PERIOD_TIMES[i][1]) { return false; }
    }
    return true;
  }

  /* ── 固定提示词（与规划文档 §10 一致） ────────────────────── */

  /* 自定义文本格式 AR-TXT v1：
     一行一门课，字段用「全角竖线 ｜」分隔（半角 | 也认），
     不依赖 Markdown 表格，复制粘贴时不会被对齐/换行搞坏。 */
  var PROMPT_VERSION = 'ar-txt-1.1.0';
  var FMT_SEP = '｜';
  var FMT_HEADER = 'AbbeyRoad 课表 v1';
  var PROMPT_TEXT = [
    '把这张课表整理成下面的纯文本格式，直接输出文本，不要表格、不要解释。',
    '',
    FMT_HEADER,
    '开学日期：2026-09-07',
    '高等数学' + FMT_SEP + '周一' + FMT_SEP + '1-2' + FMT_SEP + '1-16' + FMT_SEP + 'XX大学 信息楼305' + FMT_SEP + '张三' + FMT_SEP + '需带教材' + FMT_SEP + '蓝',
    '大学物理' + FMT_SEP + '周三' + FMT_SEP + '5-6' + FMT_SEP + '双周' + FMT_SEP + 'XX大学 物理楼101' + FMT_SEP + '李四' + FMT_SEP + '' + FMT_SEP + '橙',
    '考试' + FMT_SEP + '高等数学 期中' + FMT_SEP + '2026-11-12' + FMT_SEP + '14:00-16:00' + FMT_SEP + 'XX大学 信息楼305' + FMT_SEP + '闭卷',
    '',
    '规则：',
    '1. 第一行照抄「' + FMT_HEADER + '」，第二行写开学日期（不知道就写 ?）。',
    '2. 每门课一行，字段顺序固定：课程名' + FMT_SEP + '星期' + FMT_SEP + '节次' + FMT_SEP + '周次' + FMT_SEP + '地点' + FMT_SEP + '老师' + FMT_SEP + '备注' + FMT_SEP + '颜色。',
    '3. 字段之间用全角竖线 ' + FMT_SEP + ' 分隔（复制成半角 | 也没关系）；没有的字段留空，例如：英语' + FMT_SEP + '周五' + FMT_SEP + '3-4' + FMT_SEP + '1-16' + FMT_SEP + '文科楼401。',
    '4. 星期写 周一…周日；节次写 1-2（连堂也这样写，两行相邻的 1-2 和 3-4 会自动合并）；周次写 1-16、单周、双周 或 全周。',
    '5. 调课/停课另起一行：调课' + FMT_SEP + '课程名' + FMT_SEP + '2026-10-08' + FMT_SEP + '周四' + FMT_SEP + '1-2' + FMT_SEP + '新地点' + FMT_SEP + '原因；停课' + FMT_SEP + '课程名' + FMT_SEP + '2026-10-01。',
    '6. 颜色：照着原图里这门课的颜色写（红/橙/黄/绿/青/蓝/紫/粉/棕/灰，或 #RRGGBB）。看不清就留空，App 会自动分配。',
    '7. 考试、讲座、活动这类不在课表里的事件另起一行：类型（考试/讲座/活动）' + FMT_SEP + '标题' + FMT_SEP
      + '日期(YYYY-MM-DD)' + FMT_SEP + '时间(14:00-16:00，可空)' + FMT_SEP + '地点' + FMT_SEP + '备注。',
    '8. 不要输出表格、不要输出解释、不要编造看不清的内容（写 ? 即可）。'
  ].join('\n');

  /* ── 数据仓库 ─────────────────────────────────────────────── */

  function defaultSettings(semesterId) {
    return {
      appearance: {
        theme: 'system', accent: '#5B8DEF', glassLevel: 'medium',
        animationSpeed: 1
      },
      layout: { preset: 'dual-horizontal', followDeviceSuggestion: true },
      schedule: { currentSemesterId: semesterId, weekStartDay: 1, autoMergeConsecutive: 'auto' },
      /**
       * 「最近的课」按离上课时间切状态色（全部可在设置里改）：
       *   near = 距上课 ≤ nearMin 分钟（默认 15，红色 + 加粗边框）
       *   soon = 距上课 ≤ soonMin 分钟（默认 30，黄色 + 加粗边框）
       *   live = 正在上课（蓝色 + 加粗边框）
       *   其它情况保持课程自己的颜色、边框不加粗
       */
      nextAlert: {
        enabled: true, nearMin: 15, soonMin: 30, thickBorder: true,
        colors: { near: '#E5484D', soon: '#D9A22B', live: '#5B8DEF' }
      },
      haptics: { enabled: true, intensity: 'medium' },
      notifications: { enabled: false, defaultOffset: 15 },
      integration: {
        university: '', campus: '', city: '', navApp: 'system',
        trimRoom: true, keepCampus: true, autoPrependUniversity: true,
        appendCityWhenAmbiguous: true, onlineTreatAsNoNav: true
      },
      onboardingCompletedAt: null
    };
  }

  function defaultState() {
    var semId = uid();
    var now = new Date();
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'abbeyroad.sync',
      exportedAt: null,
      appVersion: APP_VERSION,
      device: { id: uid(), name: '', platform: '' },
      settings: defaultSettings(semId),
      semesters: [{
        id: semId, name: '我的学期', startDate: dateKey(mondayOf(now)),
        weekCount: 20, isCurrent: true, holidays: [],
        updatedAt: now.toISOString()
      }],
      periods: makePeriods(semId),
      teachers: [], locations: [], courses: [], blocks: [], overrides: [],
      events: [],
      reminders: [], promptTemplates: [{
        id: 'default', version: PROMPT_VERSION, title: '默认课表整理提示词',
        body: PROMPT_TEXT, isDefault: true
      }],
      tombstones: []
    };
  }

  var state = null;
  var saveTimer = null;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.kind === 'abbeyroad.sync') { state = migrate(parsed); }
      }
    } catch (e) {
      console.warn('读取本地数据失败，改用新数据', e);
    }
    if (!state) { state = defaultState(); }
    return state;
  }

  /** 版本迁移入口：目前只有 v1，保留结构方便以后加字段 */
  function migrate(s) {
    if (!s.settings) { s.settings = defaultSettings((s.semesters && s.semesters[0] && s.semesters[0].id) || uid()); }
    if (!s.settings.layout) { s.settings.layout = { preset: 'dual-horizontal', followDeviceSuggestion: true }; }
    // v0.1.8：布局只保留「左右 / 上中下」，旧的「自动」「左中右」统一折算成「左右」
    s.settings.layout.preset = (s.settings.layout.preset === 'stacked-vertical') ? 'stacked-vertical' : 'dual-horizontal';
    // v0.1.8：「减少动效」入口已删除，旧数据里的开关一并清掉，避免"动画不动"的残留状态
    if (s.settings.appearance) { delete s.settings.appearance.reduceMotion; }
    // v0.1.9：「最近的课」状态色（老数据补默认值，阈值与颜色都保留用户改过的）
    var def = defaultSettings((s.semesters && s.semesters[0] && s.semesters[0].id) || uid()).nextAlert;
    if (!s.settings.nextAlert) { s.settings.nextAlert = def; }
    else {
      var na = s.settings.nextAlert;
      if (typeof na.enabled !== 'boolean') { na.enabled = def.enabled; }
      if (!(Number(na.nearMin) > 0)) { na.nearMin = def.nearMin; }
      if (!(Number(na.soonMin) > 0)) { na.soonMin = def.soonMin; }
      if (typeof na.thickBorder !== 'boolean') { na.thickBorder = def.thickBorder; }
      na.colors = na.colors || {};
      for (var ck in def.colors) {
        if (Object.prototype.hasOwnProperty.call(def.colors, ck) && !na.colors[ck]) { na.colors[ck] = def.colors[ck]; }
      }
    }
    if (!s.periods || !s.periods.length) {
      var sid = (s.semesters && s.semesters[0] && s.semesters[0].id) || uid();
      s.periods = makePeriods(sid);
    }
    /**
     * v0.2.1：默认作息换成新表。
     * 只有「还是老默认作息」的数据才会被换掉；用户自己改过节次时间就保持原样，
     * 免得把别人的作息覆盖掉。课程只记节次号，所以换时间不影响任何一节课的位置。
     */
    else if (isOldDefaultPeriods(s.periods)) {
      s.periods = makePeriods((s.semesters && s.semesters[0] && s.semesters[0].id) || uid());
    }
    /**
     * v0.2.2 数据清理：删掉指向「不存在的课程」的孤儿时段 / 变动。
     * 这些记录界面上永远画不出来（找不到课程直接跳过），但会一直占着文件体积，
     * 大多是早期版本重复导入同一份课表留下的。
     */
    if (Array.isArray(s.blocks) && Array.isArray(s.courses)) {
      var aliveIds = {};
      for (var ci = 0; ci < s.courses.length; ci++) { aliveIds[s.courses[ci].id] = true; }
      var keptBlocks = [];
      for (var bi = 0; bi < s.blocks.length; bi++) {
        if (aliveIds[s.blocks[bi].courseId]) { keptBlocks.push(s.blocks[bi]); }
      }
      if (keptBlocks.length !== s.blocks.length) { s.blocks = keptBlocks; }
      if (Array.isArray(s.overrides)) {
        s.overrides = s.overrides.filter(function (ov) { return aliveIds[ov.courseId]; });
      }
    }
    /**
     * v0.2.3：节次表如果挂在「已经不存在的学期」上，认领给当前学期。
     * 否则一旦要补课次，就会出现「只有新补的那几节」的怪现象。
     */
    if (Array.isArray(s.periods) && Array.isArray(s.semesters) && s.semesters.length) {
      var semIds = {};
      for (var si = 0; si < s.semesters.length; si++) { semIds[s.semesters[si].id] = true; }
      var curSemId = (s.settings && s.settings.schedule && s.settings.schedule.currentSemesterId) || s.semesters[0].id;
      var hasOwnPeriods = false;
      for (var pi = 0; pi < s.periods.length; pi++) {
        if (s.periods[pi].semesterId === curSemId) { hasOwnPeriods = true; break; }
      }
      if (!hasOwnPeriods) {
        for (var pk = 0; pk < s.periods.length; pk++) {
          if (!semIds[s.periods[pk].semesterId]) { s.periods[pk].semesterId = curSemId; }
        }
      }
    }
    if (!s.promptTemplates || !s.promptTemplates.length) {
      s.promptTemplates = [{ id: 'default', version: PROMPT_VERSION, title: '默认课表整理提示词', body: PROMPT_TEXT, isDefault: true }];
    }
    var lists = ['semesters', 'teachers', 'locations', 'courses', 'blocks', 'overrides', 'events', 'reminders', 'tombstones'];
    for (var i = 0; i < lists.length; i++) { if (!Array.isArray(s[lists[i]])) { s[lists[i]] = []; } }
    s.schemaVersion = SCHEMA_VERSION;
    return s;
  }

  function save(immediate) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var write = function () {
      try {
        state.exportedAt = state.exportedAt; // 保持用户上次导出时间
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('保存失败', e);
      }
    };
    if (immediate) { write(); } else { saveTimer = setTimeout(write, 220); }
  }

  function get() { return state; }

  function reset(keepDevice) {
    var dev = state.device;
    var ob = state.settings.onboardingCompletedAt;
    state = defaultState();
    if (keepDevice && dev) { state.device = dev; }
    if (ob) { state.settings.onboardingCompletedAt = ob; }
    save(true);
    return state;
  }

  /** 当前学期 */
  function currentSemester() {
    var list = state.semesters || [];
    var id = state.settings.schedule.currentSemesterId;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return list[0] || null;
  }

  function periodsOf(semesterId) {
    var out = [];
    for (var i = 0; i < state.periods.length; i++) {
      if (state.periods[i].semesterId === semesterId) { out.push(state.periods[i]); }
    }
    out.sort(function (a, b) { return a.index - b.index; });
    if (!out.length) { out = state.periods.slice().sort(function (a, b) { return a.index - b.index; }); }
    return out;
  }

  function courseById(id) {
    for (var i = 0; i < state.courses.length; i++) { if (state.courses[i].id === id) { return state.courses[i]; } }
    return null;
  }

  /* ── 特殊事件（考试 / 讲座 / 活动）───────────────────────── */

  /** 某一天的事件，按开始时间排序 */
  function eventsOf(date) {
    var key = (typeof date === 'string') ? date : dateKey(date);
    var out = [];
    var list = state.events || [];
    for (var i = 0; i < list.length; i++) { if (list[i].date === key) { out.push(list[i]); } }
    out.sort(function (a, b) { return String(a.start || '99:99').localeCompare(String(b.start || '99:99')); });
    return out;
  }

  /** 日期区间（含两端）内的事件 */
  function eventsBetween(fromKey, toKey) {
    var out = [];
    var list = state.events || [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i].date || '';
      if (d >= fromKey && d <= toKey) { out.push(list[i]); }
    }
    out.sort(function (a, b) {
      var c = String(a.date).localeCompare(String(b.date));
      return c !== 0 ? c : String(a.start || '99:99').localeCompare(String(b.start || '99:99'));
    });
    return out;
  }

  /** 某一周（周一到周日）的事件 */
  function eventsInWeek(weekNo, sem) {
    sem = sem || currentSemester();
    if (!sem || !sem.startDate) { return []; }
    var monday = addDays(mondayOf(parseDateKey(sem.startDate)), (Math.max(1, weekNo) - 1) * 7);
    return eventsBetween(dateKey(monday), dateKey(addDays(monday, 6)));
  }

  /** 新增 / 更新一个事件 */
  function saveEvent(ev) {
    state.events = state.events || [];
    var rec = {
      id: ev.id || uid(),
      title: String(ev.title || '').trim(),
      type: eventType(ev.type).key,
      date: ev.date || '',
      start: ev.start || '',
      end: ev.end || '',
      place: ev.place || '',
      note: ev.note || '',
      updatedAt: new Date().toISOString()
    };
    var replaced = false;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === rec.id) { state.events[i] = rec; replaced = true; break; }
    }
    if (!replaced) { state.events.push(rec); }
    save(true);
    return rec;
  }

  function removeEvent(id) {
    state.events = state.events || [];
    var kept = [];
    for (var i = 0; i < state.events.length; i++) { if (state.events[i].id !== id) { kept.push(state.events[i]); } }
    state.events = kept;
    markDeleted('events', id);
    save(true);
  }

  /**
   * 改课程名：同名课程会被认成同一门，并统一颜色。
   * 如果改成一个已存在的课程名，就把这门课的时段并过去，删掉空壳课程。
   */
  function renameCourse(courseId, newName) {
    var name = String(newName || '').trim();
    if (!name) { return { ok: false, message: '课程名不能为空' }; }
    var self = courseById(courseId);
    if (!self) { return { ok: false, message: '找不到这门课' }; }
    if (self.name === name) { return { ok: true, merged: false, course: self }; }

    var target = null;
    for (var i = 0; i < state.courses.length; i++) {
      if (state.courses[i].id !== courseId && state.courses[i].name === name) { target = state.courses[i]; break; }
    }
    var nowIso = new Date().toISOString();
    var merged = false;
    if (target) {
      // 合并：把时段 + 变动记录改挂到目标课程上，然后删掉这门课
      for (var b = 0; b < state.blocks.length; b++) {
        if (state.blocks[b].courseId === courseId) {
          state.blocks[b].courseId = target.id;
          state.blocks[b].courseName = name;
          state.blocks[b].updatedAt = nowIso;
        }
      }
      for (var b3 = 0; b3 < state.blocks.length; b3++) {
        if (state.blocks[b3].courseId === target.id) { state.blocks[b3].courseName = name; }
      }
      for (var o = 0; o < state.overrides.length; o++) {
        if (state.overrides[o].courseId === courseId) { state.overrides[o].courseId = target.id; }
      }
      var keptCourses = [];
      for (var c = 0; c < state.courses.length; c++) {
        if (state.courses[c].id !== courseId) { keptCourses.push(state.courses[c]); }
      }
      state.courses = keptCourses;
      markDeleted('courses', courseId);
      merged = true;
    } else {
      self.name = name;
      self.updatedAt = nowIso;
      for (var b2 = 0; b2 < state.blocks.length; b2++) {
        if (state.blocks[b2].courseId === courseId) { state.blocks[b2].courseName = name; state.blocks[b2].updatedAt = nowIso; }
      }
    }

    // 同名 → 同色：把该名字下所有课程的颜色统一成同一个
    var group = [];
    for (var g = 0; g < state.courses.length; g++) {
      if (state.courses[g].name === name) { group.push(state.courses[g]); }
    }
    if (group.length > 1) {
      var keep = group[0].colorKey;
      for (var k = 1; k < group.length; k++) { group[k].colorKey = keep; group[k].updatedAt = nowIso; }
    }
    save(true);
    return { ok: true, merged: merged, course: target || self, colorKey: group.length ? group[0].colorKey : (target || self).colorKey };
  }

  /** 同名课程统一颜色（导入后调用，保证「同名同色」） */
  function unifyColorsByName() {
    var byName = {};
    var changed = false;
    for (var i = 0; i < state.courses.length; i++) {
      var c = state.courses[i];
      if (!byName[c.name]) { byName[c.name] = c.colorKey; continue; }
      if (c.colorKey !== byName[c.name]) { c.colorKey = byName[c.name]; changed = true; }
    }
    if (changed) { save(true); }
    return changed;
  }
  function teacherById(id) {
    for (var i = 0; i < state.teachers.length; i++) { if (state.teachers[i].id === id) { return state.teachers[i]; } }
    return null;
  }
  function locationById(id) {
    for (var i = 0; i < state.locations.length; i++) { if (state.locations[i].id === id) { return state.locations[i]; } }
    return null;
  }
  function blocksOfCourse(id) {
    var out = [];
    for (var i = 0; i < state.blocks.length; i++) { if (state.blocks[i].courseId === id) { out.push(state.blocks[i]); } }
    return out;
  }
  function overridesOfBlock(id) {
    var out = [];
    for (var i = 0; i < state.overrides.length; i++) { if (state.overrides[i].blockId === id) { out.push(state.overrides[i]); } }
    return out;
  }

  /* ── 编辑入口（v0.2.0：今日页条目 / 周表单节课程都能直接改）───── */

  function blockById(id) {
    for (var i = 0; i < state.blocks.length; i++) { if (state.blocks[i].id === id) { return state.blocks[i]; } }
    return null;
  }

  function overrideById(id) {
    for (var i = 0; i < state.overrides.length; i++) { if (state.overrides[i].id === id) { return state.overrides[i]; } }
    return null;
  }

  /** 按名字找老师；没有就现建一个（周表里直接改老师名时用） */
  function ensureTeacherByName(name) {
    var n = String(name == null ? '' : name).trim();
    if (!n) { return null; }
    for (var i = 0; i < state.teachers.length; i++) {
      if (String(state.teachers[i].name || '').trim() === n) { return state.teachers[i]; }
    }
    var t = { id: uid(), name: n, note: '', contact: '', updatedAt: new Date().toISOString() };
    state.teachers.push(t);
    return t;
  }

  /** 按原始文本找地点；没有就按地点解析规则新建（和导入时的处理完全一致） */
  function ensureLocationByRaw(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) { return null; }
    for (var i = 0; i < state.locations.length; i++) {
      if (String(state.locations[i].raw || '').trim() === v) { return state.locations[i]; }
    }
    var parts = { building: '', campus: '', university: '', city: '', room: '' };
    if (AR.MdParse && AR.MdParse.parsePlaceParts) {
      parts = AR.MdParse.parsePlaceParts(v, state.settings.integration) || parts;
    }
    var loc = {
      id: uid(), raw: v, building: parts.building, campus: parts.campus,
      university: parts.university, city: parts.city, room: parts.room,
      navQueryOverride: '', updatedAt: new Date().toISOString()
    };
    state.locations.push(loc);
    return loc;
  }

  /** 把 [1,2,3,5,7,8] 压成 "1-3,5,7-8" */
  function compressWeeks(list) {
    var w = (list || []).slice().sort(function (a, b) { return a - b; });
    if (!w.length) { return ''; }
    var parts = [], s = w[0], prev = w[0];
    for (var i = 1; i <= w.length; i++) {
      var cur = w[i];
      if (cur !== prev + 1) {
        parts.push(s === prev ? ('' + s) : (s + '-' + prev));
        s = cur;
      }
      prev = cur;
    }
    return parts.join(',');
  }

  /** block 的周次 → 可直接编辑的文本：全周 / 单周 / 双周 / 1-8,10 */
  function weeksText(block, weekCount) {
    if (!block) { return '全周'; }
    if (block.weekMode === 'odd') { return '单周'; }
    if (block.weekMode === 'even') { return '双周'; }
    if (block.weekMode === 'custom' && block.weeks && block.weeks.length) {
      return compressWeeks(block.weeks);
    }
    return '全周';
  }

  /**
   * 解析周次文本（和提示词规范里的写法一致）：
   *   全周 / 每周 / 空     → { weekMode:'all',   weeks:[] }
   *   单周 / 双周          → { weekMode:'odd'|'even', weeks:[] }
   *   1-8,10,12           → { weekMode:'custom', weeks:[1..8,10,12] }
   */
  function parseWeeksText(text, weekCount) {
    var n = weekCount || 20;
    var s = String(text == null ? '' : text).trim().replace(/[，、;；]/g, ',');
    if (!s) { return { weekMode: 'all', weeks: [] }; }
    if (/^(全周|每周|全部|all)$/i.test(s)) { return { weekMode: 'all', weeks: [] }; }
    if (/^(单周|单数周|单)$/.test(s)) { return { weekMode: 'odd', weeks: [] }; }
    if (/^(双周|双数周|双)$/.test(s)) { return { weekMode: 'even', weeks: [] }; }
    var out = [];
    var parts = s.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) { continue; }
      var m = /^(\d{1,2})\s*[-~－—至]\s*(\d{1,2})$/.exec(p);
      if (m) {
        var a = Number(m[1]), b = Number(m[2]);
        if (a > b) { var t = a; a = b; b = t; }
        for (var w = a; w <= b; w++) { if (w >= 1 && w <= n && out.indexOf(w) < 0) { out.push(w); } }
        continue;
      }
      var one = Number(p);
      if (!isNaN(one) && one >= 1 && one <= n && out.indexOf(one) < 0) { out.push(one); }
    }
    out.sort(function (x, y) { return x - y; });
    if (!out.length) { return { weekMode: 'all', weeks: [] }; }
    return { weekMode: 'custom', weeks: out };
  }

  /** 只改一个时段（block）：字段直接合并进去，未传的字段保持原样 */
  function updateBlock(blockId, patch) {
    var b = blockById(blockId);
    if (!b) { return { ok: false, message: '找不到这个时段' }; }
    var nowIso = new Date().toISOString();
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) { b[k] = patch[k]; }
    }
    b.updatedAt = nowIso;
    save(true);
    return { ok: true, block: b };
  }

  /** 删掉一个时段（只删这一次排课，不删整门课） */
  function removeBlock(blockId) {
    var b = blockById(blockId);
    if (!b) { return { ok: false }; }
    markDeleted('blocks', blockId);
    state.blocks = state.blocks.filter(function (x) { return x.id !== blockId; });
    // 挂在这个时段上的单次变动也一起清掉，避免留下孤儿记录
    var keptOv = [];
    for (var i = 0; i < state.overrides.length; i++) {
      if (state.overrides[i].blockId === blockId) { markDeleted('overrides', state.overrides[i].id); }
      else { keptOv.push(state.overrides[i]); }
    }
    state.overrides = keptOv;
    save(true);
    return { ok: true };
  }

  /**
   * 给「某一天的这一次课」写一条变动记录（仅这一次模式）。
   * 已存在同一天同 block 的记录就直接合并，不会越改越多条。
   */
  function upsertOverride(blockId, courseId, dateKey, patch) {
    var ov = null;
    for (var i = 0; i < state.overrides.length; i++) {
      var o = state.overrides[i];
      if (o.blockId === blockId && o.date === dateKey) { ov = o; break; }
    }
    var nowIso = new Date().toISOString();
    if (!ov) {
      ov = {
        id: uid(), courseId: courseId, blockId: blockId, date: dateKey, type: 'edit',
        newWeekday: null, newDate: null, newPeriodStart: null, newPeriodEnd: null,
        newStartTime: '', newEndTime: '', newLocationIds: null, newTeacherIds: null,
        newNote: null, reason: '', updatedAt: nowIso
      };
      state.overrides.push(ov);
    }
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) { ov[k] = patch[k]; }
    }
    ov.updatedAt = nowIso;
    save(true);
    return ov;
  }

  function removeOverride(id) {
    var ov = overrideById(id);
    if (!ov) { return { ok: false }; }
    markDeleted('overrides', id);
    state.overrides = state.overrides.filter(function (x) { return x.id !== id; });
    save(true);
    return { ok: true };
  }

  /* ── 节次表自动扩展（v0.2.2：第 13 节及以后的课也要能显示）───── */

  function semesterExists(id) {
    for (var i = 0; i < state.semesters.length; i++) {
      if (state.semesters[i].id === id) { return true; }
    }
    return false;
  }

  /**
   * 确保某个学期「拥有自己的节次表」，返回这张表。
   *
   * 为什么需要它：历史数据里出现过「节次挂在已经不存在的学期上」的情况，
   * 平时靠 periodsOf() 的兜底（没找到就用全部节次）勉强显示；
   * 一旦要补课次，就会凭空多出几条「只属于当前学期」的节次，
   * 兜底失效 → 课表只剩那几条，作息全乱。
   */
  function claimPeriodsFor(semId) {
    var own = [];
    for (var i = 0; i < state.periods.length; i++) {
      if (state.periods[i].semesterId === semId) { own.push(state.periods[i]); }
    }
    if (own.length) { return own; }
    // 先认领「没有归属（学期已不存在）」的节次
    var loose = [];
    for (i = 0; i < state.periods.length; i++) {
      if (!semesterExists(state.periods[i].semesterId)) { loose.push(state.periods[i]); }
    }
    if (loose.length) {
      for (i = 0; i < loose.length; i++) {
        loose[i].semesterId = semId;
        loose[i].updatedAt = new Date().toISOString();
      }
      return loose;
    }
    // 一条都没有（清空 / 新设备）：按默认作息铺一张
    var fresh = makePeriods(semId);
    state.periods = state.periods.concat(fresh);
    return fresh;
  }

  /**
   * 课表用到了第 needIndex 节、但节次表不够 → 自动补课次。
   * 新补的时间接着最后一节往下排（间隔 10 分钟、每节 45 分钟，最晚到 23:59），
   * 用户可以随时在 设置 → 课程与课表 → 节次时间 里改。
   * 返回新增的节数（0 = 没动）。
   */
  function ensurePeriodsFor(semesterId, needIndex) {
    var sid = semesterId || (currentSemester() || {}).id;
    var periods = claimPeriodsFor(sid);      // 先保证这张表真的属于这个学期
    var max = 0, last = null, i;
    for (i = 0; i < periods.length; i++) {
      if (periods[i].index > max) { max = periods[i].index; last = periods[i]; }
    }
    if (!needIndex || needIndex <= max) { return 0; }
    var nowIso = new Date().toISOString();
    if (!last) { return 0; }
    var added = 0;
    var cursor = last.end;
    for (var idx = max + 1; idx <= needIndex; idx++) {
      var sMin = hmToMinutes(cursor);
      var start = sMin == null ? '' : minutesToHM(Math.min(sMin + 10, 23 * 60 + 50));
      var end = sMin == null ? '' : minutesToHM(Math.min(sMin + 10 + 45, 23 * 60 + 59));
      state.periods.push({
        id: uid(), semesterId: sid, index: idx, label: '第' + idx + '节',
        start: start, end: end, updatedAt: nowIso, autoAdded: true
      });
      if (end) { cursor = end; }
      added++;
    }
    if (added) { save(true); }
    return added;
  }

  /** 按现有课表实际用到的最大节次补齐节次表（导入 / 合并配置后调用） */
  function syncPeriodsToUsage(semesterId) {
    var need = 0, i;
    for (i = 0; i < state.blocks.length; i++) {
      var b = state.blocks[i];
      var e = b.periodEnd || b.periodStart || 0;
      if (e > need) { need = e; }
    }
    for (i = 0; i < state.overrides.length; i++) {
      var ov = state.overrides[i];
      var oe = ov.newPeriodEnd || ov.newPeriodStart || 0;
      if (oe > need) { need = oe; }
    }
    return ensurePeriodsFor(semesterId, need);
  }

  /* ── 合并后的「当前学期」纠偏（v0.2.3）──────────────────────── */

  /** 某个学期下有多少条时段（用来判断这个学期是不是空的） */
  function blockCountOfSemester(semId) {
    if (!semId) { return 0; }
    var n = 0;
    for (var i = 0; i < state.blocks.length; i++) {
      var c = courseById(state.blocks[i].courseId);
      if (c && c.semesterId === semId) { n++; }
    }
    return n;
  }

  /** 课最多的那个学期（导入别人配置后，用它兜底） */
  function busiestSemesterId() {
    var counts = {}, best = null, bestN = 0, k;
    for (var i = 0; i < state.blocks.length; i++) {
      var c = courseById(state.blocks[i].courseId);
      if (!c || !c.semesterId) { continue; }
      counts[c.semesterId] = (counts[c.semesterId] || 0) + 1;
    }
    for (k in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, k) && counts[k] > bestN) {
        best = k; bestN = counts[k];
      }
    }
    return best;
  }

  /**
   * 导入/合并之后调用：如果「当前学期」一门课都没有、而数据挂在别的学期上，
   * 就把当前学期切过去。
   *
   * 这是「清空数据 → 导入原来的配置文件 → 界面还是空的」的根因：
   * 清空会新建一个空学期，导入的数据落在文件里那个学期上，
   * 界面按「当前学期」过滤 → 什么都看不到。
   *
   * preferId 一般传配置文件里记录的「对方当前学期」，对得上就优先用它。
   * 返回是否切换了学期。
   */
  function ensureCurrentSemesterHasData(preferId) {
    var cur = currentSemester();
    if (cur && blockCountOfSemester(cur.id) > 0) { return false; }
    var target = null;
    if (preferId) {
      var mapped = semesterById(preferId) ? preferId : null;
      if (mapped && blockCountOfSemester(mapped) > 0) { target = mapped; }
    }
    if (!target) { target = busiestSemesterId(); }
    if (!target || (cur && cur.id === target)) { return false; }
    state.settings.schedule.currentSemesterId = target;
    claimPeriodsFor(target);      // 切学期时把节次表也带过去，别留下空作息
    save(true);
    return true;
  }

  function semesterById(id) {
    for (var i = 0; i < state.semesters.length; i++) {
      if (state.semesters[i].id === id) { return state.semesters[i]; }
    }
    return null;
  }

  /** 全部学期（按开学日期从新到旧），周表上的「切换学期」用 */
  function semesterList() {
    var list = (state.semesters || []).slice();
    list.sort(function (a, b) { return String(b.startDate || '').localeCompare(String(a.startDate || '')); });
    return list;
  }

  /**
   * 切换到某个学期（周表右上角的学期按钮用）。
   * 顺便把节次表认领到这个学期，避免切过去发现作息是空的。
   */
  function setCurrentSemester(id) {
    if (!semesterById(id)) { return { ok: false, message: '找不到这个学期' }; }
    state.settings.schedule.currentSemesterId = id;
    claimPeriodsFor(id);
    save(true);
    return { ok: true, semester: semesterById(id) };
  }

  /** 这个学期有多少门课（切换学期时给用户看的） */
  function courseCountOfSemester(semId) {
    var n = 0;
    for (var i = 0; i < state.courses.length; i++) {
      if (state.courses[i].semesterId === semId) { n++; }
    }
    return n;
  }

  /** 新建一个学期并切过去（周表右上角「切换学期 → 新建学期」） */
  function addSemester(info) {
    var name = String((info && info.name) || '').trim();
    if (!name) { return { ok: false, message: '学期名称不能为空' }; }
    var start = (info && info.startDate) || dateKey(mondayOf(new Date()));
    var weeks = Math.max(1, Math.min(30, Number(info && info.weekCount) || 20));
    var id = uid();
    var sem = {
      id: id, name: name, startDate: start, weekCount: weeks,
      isCurrent: true, holidays: [], updatedAt: new Date().toISOString()
    };
    state.semesters.push(sem);
    state.periods = state.periods.concat(makePeriods(id));   // 新学期的作息用默认表
    state.settings.schedule.currentSemesterId = id;
    save(true);
    return { ok: true, semester: sem };
  }

  /* ── 课表计算 ─────────────────────────────────────────────── */

  /** 第几周（1 起）；学期未开始返回 0，超出总周数返回 >weekCount */
  function weekNumber(date, semester) {
    var sem = semester || currentSemester();
    if (!sem) { return 0; }
    var start = parseDateKey(sem.startDate);
    if (!start) { return 0; }
    var base = mondayOf(start);
    var diff = startOfDay(date).getTime() - base.getTime();
    return Math.floor(diff / (7 * 86400000)) + 1;
  }

  /** 展开周次集合：all / odd / even / custom */
  function expandWeeks(block, weekCount) {
    var n = weekCount || 20;
    var out = [];
    var i;
    if (block.weekMode === 'odd') {
      for (i = 1; i <= n; i += 2) { out.push(i); }
    } else if (block.weekMode === 'even') {
      for (i = 2; i <= n; i += 2) { out.push(i); }
    } else if (block.weekMode === 'custom' && block.weeks && block.weeks.length) {
      out = block.weeks.slice();
    } else {
      for (i = 1; i <= n; i++) { out.push(i); }
    }
    return out;
  }

  function weeksLabel(block, weekCount) {
    var w = expandWeeks(block, weekCount);
    if (!w.length) { return '未设置周次'; }
    if (w.length === (weekCount || 20)) { return '1-' + (weekCount || 20) + ' 全周'; }
    var mode = block.weekMode;
    if (mode === 'odd') { return '1-' + (weekCount || 20) + ' 单周'; }
    if (mode === 'even') { return '1-' + (weekCount || 20) + ' 双周'; }
    // 连续区间压缩显示
    var parts = [], s = w[0], prev = w[0];
    for (var i = 1; i <= w.length; i++) {
      var cur = w[i];
      if (cur !== prev + 1) {
        parts.push(s === prev ? ('' + s) : (s + '-' + prev));
        s = cur;
      }
      prev = cur;
    }
    return parts.join(',') + ' 周';
  }

  function periodRange(block, periods) {
    var start = block.periodStart, end = block.periodEnd || block.periodStart;
    var p1 = null, p2 = null;
    for (var i = 0; i < periods.length; i++) {
      if (periods[i].index === start) { p1 = periods[i]; }
      if (periods[i].index === end) { p2 = periods[i]; }
    }
    // v0.2.0：单个时段可以自己写死一个时间（block.startTime / endTime），
    // 这样「这门课这学期就是 07:50 开始」不用去改整张节次表。
    var st = block.startTime || (p1 ? p1.start : '');
    var en = block.endTime || (p2 ? p2.end : (p1 ? p1.end : ''));
    if (!st && !p1) { return null; }
    var label = start
      ? (start === end ? ('第' + start + '节') : (start + '-' + end + '节'))
      : '单次课';
    return {
      start: st, end: en,
      label: block.startTime ? (label + ' · 自定义时间') : label
    };
  }

  /**
   * 把某个 block 在指定日期的实际发生（含调课/停课/换教室）算出来。
   * 返回 item 或 null。
   */
  function blockOccurrence(block, date, semester, periods) {
    var sem = semester || currentSemester();
    var week = weekNumber(date, sem);
    var wd = weekdayOf(date);
    var item = {
      blockId: block.id, courseId: block.courseId, date: date, weekday: wd,
      override: null, kind: 'normal'
    };

    // 1) 单次覆盖：停课 / 调课（改到别的日期）
    var ovs = overridesOfBlock(block.id);
    for (var i = 0; i < ovs.length; i++) {
      var ov = ovs[i];
      var ovDate = parseDateKey(ov.date);
      if (!ovDate || !sameDay(ovDate, date)) { continue; }
      if (ov.type === 'cancel') { return null; }
      /**
       * 本次修复（v0.3.0 补丁）：把 'edit'（编辑窗口里选「仅这次」保存）也算成「这一次课的覆盖」。
       * 以前这里只认 move / time / room，于是「仅这次」改完备注、地点、时间之后
       * blockOccurrence 根本不认这条记录 —— 界面上一点变化都没有，
       * 用户看到的就是「备注改了但没用」。
       */
      if (ov.type === 'move' || ov.type === 'time' || ov.type === 'room' || ov.type === 'edit') {
        item.override = ov;
        item.kind = ov.type;
        return item;
      }
    }
    if (ovs.length) {
      for (var j = 0; j < ovs.length; j++) {
        if (ovs[j].type === 'move' && ovs[j].newDate) {
          var nd = parseDateKey(ovs[j].newDate);
          if (nd && sameDay(nd, date)) {
            item.override = ovs[j];
            item.kind = 'moved-in';
            return item;
          }
        }
      }
    }

    // 2) 常规模板
    if (block.weekday !== wd) { return null; }
    var weeks = expandWeeks(block, sem ? sem.weekCount : 20);
    if (weeks.indexOf(week) < 0) { return null; }
    return item;
  }

  /**
   * 组装一天的完整日程（含补课/加课），按开始时间排序。
   */
  function dayItems(date, semester) {
    var sem = semester || currentSemester();
    var periods = periodsOf(sem && sem.id);
    var out = [];
    var i, item, block, course, pr;

    for (i = 0; i < state.blocks.length; i++) {
      block = state.blocks[i];
      course = courseById(block.courseId);
      if (!course) { continue; }
      if (sem && course.semesterId && course.semesterId !== sem.id) { continue; }
      item = blockOccurrence(block, date, sem, periods);
      if (!item) { continue; }
      out.push(decorate(item, block, course, periods));
    }

    // 补课 / 加课：直接在 overrides 上挂着的单次课
    for (i = 0; i < state.overrides.length; i++) {
      var ov = state.overrides[i];
      if (ov.type !== 'makeup' && ov.type !== 'add') { continue; }
      var od = parseDateKey(ov.date);
      if (!od || !sameDay(od, date)) { continue; }
      course = courseById(ov.courseId);
      if (!course) { continue; }
      block = {
        id: ov.blockId || ('ov_' + ov.id), courseId: ov.courseId,
        weekday: weekdayOf(od), periodStart: ov.newPeriodStart || 1,
        periodEnd: ov.newPeriodEnd || ov.newPeriodStart || 1,
        startTime: ov.newStartTime || '', endTime: ov.newEndTime || '',
        weekMode: 'custom', weeks: [], locationIds: ov.newLocationIds || [],
        note: ov.newNote || ''
      };
      item = { blockId: block.id, courseId: course.id, date: date, weekday: weekdayOf(od), override: ov, kind: ov.type };
      out.push(decorate(item, block, course, periods));
    }

    out.sort(function (a, b) {
      return (a.startMin == null ? 99999 : a.startMin) - (b.startMin == null ? 99999 : b.startMin);
    });
    return out;
  }

  /** 给 item 补上课程、时间、地点、老师等展示字段 */
  function decorate(item, block, course, periods) {
    var periodList = periods || periodsOf(course.semesterId);
    var pr = periodRange(block, periodList);
    var ov = item.override;
    var locationIds = block.locationIds || [];
    var teacherIds = block.teacherIds || (course.teacherIds || []);
    /**
     * 备注取值：以前是 block.note || course.note。
     * 导入时同一行的备注会同时写进 course 和 block 两处，于是在备注窗口里
     * 清空只清掉了 block 那一份，界面又用 course 里的兜底显示回来 ——
     * 表现就是「备注删不掉 / 改完没反应」。
     * 现在只要 block 上带着这个字段就以它为准，course 只在老数据缺字段时兜底。
     *
     * src 记录每个字段到底来自哪一层，编辑窗口据此把改动写回正确的位置
     * （override = 只影响这一天；block = 这门课所有时段）。
     */
    var note = (typeof block.note === 'string') ? block.note : (course.note || '');
    var src = {
      note: (typeof block.note === 'string') ? 'block' : 'course',
      teacher: (block.teacherIds && block.teacherIds.length) ? 'block'
        : ((course.teacherIds && course.teacherIds.length) ? 'course' : 'block'),
      location: (block.locationIds && block.locationIds.length) ? 'block'
        : (course.defaultLocationId ? 'course' : 'block')
    };

    if (ov) {
      if (ov.newPeriodStart) {
        pr = periodRange({
          periodStart: ov.newPeriodStart, periodEnd: ov.newPeriodEnd || ov.newPeriodStart,
          startTime: ov.newStartTime, endTime: ov.newEndTime
        }, periodList) || pr;
      }
      if (ov.newLocationIds && ov.newLocationIds.length) { locationIds = ov.newLocationIds; src.location = 'override'; }
      else if (ov.newLocationCleared) { locationIds = []; src.location = 'override'; }
      // v0.2.0：单次课也能单独换老师 / 清空备注（编辑窗口写入这些字段）
      if (ov.newTeacherIds) { teacherIds = ov.newTeacherIds; src.teacher = 'override'; }
      if (typeof ov.newNote === 'string' && ov.newNote !== '') { note = ov.newNote; src.note = 'override'; }
      else if (ov.newNoteCleared) { note = ''; src.note = 'override'; }
    }
    if ((!locationIds || !locationIds.length) && course.defaultLocationId) {
      locationIds = [course.defaultLocationId];
    }

    var loc = locationIds && locationIds.length ? locationById(locationIds[0]) : null;
    var teachers = [];
    for (var i = 0; i < teacherIds.length; i++) {
      var t = teacherById(teacherIds[i]);
      if (t) { teachers.push(t); }
    }

    var startMin = pr ? hmToMinutes(pr.start) : null;
    var endMin = pr ? hmToMinutes(pr.end) : null;

    return {
      blockId: item.blockId, courseId: course.id, course: course, block: block,
      override: ov, kind: item.kind, date: item.date,
      periodLabel: pr ? pr.label : '',
      start: pr ? pr.start : '', end: pr ? pr.end : '',
      startMin: startMin, endMin: endMin,
      location: loc, teachers: teachers, note: note, src: src,
      color: colorHex(course.colorKey),
      isConsecutive: !!block.isConsecutive,
      segments: block.segments || null
    };
  }

  /** 找到离现在最近的一节课（今天剩下的，否则往后 14 天） */
  function nextItem(now) {
    now = now || new Date();
    var today = startOfDay(now);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var i, items, item;

    items = dayItems(today);
    for (i = 0; i < items.length; i++) {
      if (items[i].endMin == null || items[i].endMin >= nowMin) {
        return { item: items[i], day: today, offsetDays: 0 };
      }
    }
    for (var d = 1; d <= 14; d++) {
      var day = addDays(today, d);
      items = dayItems(day);
      if (items.length) { return { item: items[0], day: day, offsetDays: d }; }
    }
    return null;
  }

  /** 当前正在进行的课（若有） */
  function ongoingItem(now) {
    now = now || new Date();
    var items = dayItems(startOfDay(now));
    var nowMin = now.getHours() * 60 + now.getMinutes();
    for (var i = 0; i < items.length; i++) {
      if (items[i].startMin != null && items[i].endMin != null &&
          nowMin >= items[i].startMin && nowMin <= items[i].endMin) {
        return items[i];
      }
    }
    return null;
  }

  /** 某周某天的课表（周表用） */
  function weekItems(weekNo, weekday) {
    var sem = currentSemester();
    if (!sem) { return []; }
    var start = parseDateKey(sem.startDate);
    if (!start) { return []; }
    var monday = addDays(mondayOf(start), (weekNo - 1) * 7);
    var date = addDays(monday, weekday - 1);
    return dayItems(date, sem);
  }

  /**
   * 冲突检测：按 (周, 星期, 节次) 建占用表。
   * C200 同一天同一节次两门不同课；C220 同一门课同一时段不同地点。
   */
  function conflicts() {
    var sem = currentSemester();
    var weekCount = sem ? sem.weekCount : 20;
    var occupancy = {};
    var out = [];
    var i, j, k, block;

    for (i = 0; i < state.blocks.length; i++) {
      block = state.blocks[i];
      var course = courseById(block.courseId);
      if (!course) { continue; }
      var weeks = expandWeeks(block, weekCount);
      var pStart = block.periodStart;
      var pEnd = block.periodEnd || block.periodStart;
      for (j = 0; j < weeks.length; j++) {
        for (k = pStart; k <= pEnd; k++) {
          var key = weeks[j] + '|' + block.weekday + '|' + k;
          if (!occupancy[key]) { occupancy[key] = []; }
          occupancy[key].push(block);
        }
      }
    }

    var seen = {};
    for (var key2 in occupancy) {
      if (!Object.prototype.hasOwnProperty.call(occupancy, key2)) { continue; }
      var list = occupancy[key2];
      if (list.length < 2) { continue; }
      var a = list[0], b = list[1];
      var ca = courseById(a.courseId), cb = courseById(b.courseId);
      if (!ca || !cb) { continue; }
      var sig = (ca.id < cb.id ? ca.id + '_' + cb.id : cb.id + '_' + ca.id) + '_' + key2.split('|')[1] + '_' + key2.split('|')[2];
      if (seen[sig]) { continue; }
      seen[sig] = true;
      var parts = key2.split('|');
      if (ca.id !== cb.id) {
        out.push({
          code: 'C200', level: 'danger',
          message: '第 ' + parts[0] + ' 周 ' + WEEKDAY_NAMES[Number(parts[1])] + ' 第 ' + parts[2] + ' 节：'
            + ca.name + ' 与 ' + cb.name + ' 时间冲突'
        });
      } else {
        var la = (a.locationIds && a.locationIds[0]) || ca.defaultLocationId;
        var lb = (b.locationIds && b.locationIds[0]) || cb.defaultLocationId;
        if (la && lb && la !== lb) {
          var l1 = locationById(la), l2 = locationById(lb);
          out.push({
            code: 'C220', level: 'warn',
            message: ca.name + ' 在同一时段有两个地点：' + (l1 ? l1.raw : la) + ' / ' + (l2 ? l2.raw : lb)
          });
        }
      }
    }
    return out;
  }

  /**
   * 连堂课自动识别（规划文档 §6.8）
   * 判定：同课程 + 同一天 + 相邻节次 + 周次集合完全一致 → 合并
   * 返回 { merged: [block], suggestions: [...] }
   */
  function mergeConsecutive(blocks, weekCount) {
    var groups = {};
    var i, b;
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      var key = b.courseId + '|' + b.weekday;
      if (!groups[key]) { groups[key] = []; }
      groups[key].push(b);
    }
    var merged = [], suggestions = [];

    for (var g in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, g)) { continue; }
      var list = groups[g].slice().sort(function (x, y) { return x.periodStart - y.periodStart; });
      var chain = [];
      for (i = 0; i < list.length; i++) {
        b = list[i];
        if (!chain.length) { chain.push(b); continue; }
        var prev = chain[chain.length - 1];
        var prevEnd = prev.periodEnd || prev.periodStart;
        var sameWeeks = sameWeekSet(prev, b, weekCount);
        if (b.periodStart === prevEnd + 1) {
          if (sameWeeks) {
            prev.periodEnd = b.periodEnd || b.periodStart;
            prev.isConsecutive = true;
            prev.segments = (prev.segments || [[prev.periodStart, prevEnd]]).concat([[b.periodStart, b.periodEnd || b.periodStart]]);
            prev.mergedIds = (prev.mergedIds || [prev.id]).concat([b.id]);
          } else {
            suggestions.push({
              a: prev, b: b,
              message: '「' + (prev.courseName || (courseById(prev.courseId) || {}).name || '该课程') + '」第 '
                + prev.periodStart + '-' + prevEnd + ' 节与第 '
                + b.periodStart + '-' + (b.periodEnd || b.periodStart) + ' 节相邻，但周次/单双周不同，是否合并为连堂？'
            });
            chain.push(b);
          }
        } else {
          chain.push(b);
        }
      }
      for (i = 0; i < chain.length; i++) { merged.push(chain[i]); }
    }
    return { merged: merged, suggestions: suggestions };
  }

  function sameWeekSet(a, b, weekCount) {
    var wa = expandWeeks(a, weekCount).slice().sort(function (x, y) { return x - y; }).join(',');
    var wb = expandWeeks(b, weekCount).slice().sort(function (x, y) { return x - y; }).join(',');
    return wa === wb;
  }

  /* ── 地点解析与导航（规划文档 §11） ──────────────────────── */

  function normalizePlace(raw) {
    var s = String(raw || '');
    // 全角 → 半角
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
    s = s.replace(/[\u3000]/g, ' ');
    s = s.replace(/[（(][^）)]*[）)]\s*$/, '');       // 去掉结尾括注
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  var ONLINE_RE = /(腾讯会议|钉钉|飞书|Zoom|zoom|直播|线上|网课|腾讯课堂|B站|bilibili|雨课堂|学习通|微信群|QQ群)/;
  var ROOM_RE = /(教室|课室|机房|实验室|报告厅|阶梯教室|智慧教室|多媒体\d*|[A-Za-z]?\d{3,4}|[东西南北]?\d-\d{2,3}|[A-Z]-\d{3})/;
  var FLOOR_RE = /\d+\s*楼|\d+\s*层|[一二三四五六七八九十]+\s*楼|[一二三四五六七八九十]+\s*层/;

  /**
   * 生成导航查询词。
   * 例：'XX大学 信息楼 305教室' → 'XX大学 信息楼'
   */
  function navQuery(rawText, settings) {
    var st = (settings || state.settings).integration;
    var raw = String(rawText || '').trim();
    var norm = normalizePlace(raw);
    var result = {
      raw: raw, normalized: norm, trimmed: '', query: '',
      online: false, usable: true, steps: []
    };
    if (!norm || norm === '?' || norm === '-' || norm === '待定') {
      result.usable = false;
      result.query = '';
      result.steps.push('地点为空或未确认');
      return result;
    }
    if (st.onlineTreatAsNoNav && ONLINE_RE.test(norm)) {
      result.online = true;
      result.usable = false;
      result.query = norm;
      result.steps.push('识别为线上课程 → 不导航，改为复制链接/会议号');
      return result;
    }

    var work = norm;
    if (st.trimRoom) {
      var before = work;
      var trimmed = trimToBuilding(work);
      // 兜底：如果裁完只剩"学校名/城市"这类其实不是地点的词，说明连楼栋名一起删掉了
      // （例如「XX大学 机房 302」），此时退回只删除纯数字的版本。
      var uni0 = (st.university || '').trim();
      var city0 = (st.city || '').trim();
      var residue = trimmed.split(/\s+/).filter(function (t) {
        return t && t !== uni0 && t !== city0;
      });
      if (!residue.length) {
        var mild = norm.split(/\s+/).filter(function (t) {
          return t && !/^[A-Za-z]?\d{1,4}$/.test(t);
        }).join(' ').trim();
        if (mild) { trimmed = mild; }
      }
      work = trimmed;
      if (work !== before) { result.steps.push('裁剪教室号/楼层'); }
    }
    // 去掉残留的连接符
    work = work.replace(/[-–—·・,，、]+$/g, '').replace(/\s+/g, ' ').trim();

    var university = (st.university || '').trim();
    var campus = (st.campus || '').trim();
    var city = (st.city || '').trim();

    if (st.keepCampus && campus && work.indexOf(campus) < 0 && norm.indexOf(campus) >= 0) {
      work = work.replace(/\s+/g, ' ').trim();
      if (work.indexOf(campus) < 0) { work = campus + ' ' + work; }
    }
    // 已经是完整地址（带门牌号，或本身就含城市）时不要再加学校名
    var fullAddress = (city && work.indexOf(city) >= 0)
      || /\d+\s*号/.test(work)
      || /(?:路|街|道|大道|巷)\s*\d*\s*号/.test(work);
    if (university && work.indexOf(university) < 0) {
      if (st.autoPrependUniversity && !fullAddress) {
        work = university + ' ' + work;
        result.steps.push('补全大学名称');
      } else if (fullAddress) {
        result.steps.push('已是完整地址，不补学校名');
      }
    }
    // 只在"没写学校名、且信息明显不足"时才追加城市，避免把完整查询词写坏
    var tooShort = work.replace(/\s/g, '').length <= 6;
    if (st.appendCityWhenAmbiguous && city && tooShort && work.indexOf(city) < 0
        && (!university || work.indexOf(university) < 0)) {
      work = work + ' ' + city;
      result.steps.push('追加城市');
    }
    // 去掉与城市重复的前缀
    if (city && work.indexOf(city) >= 0) {
      var dupe = new RegExp(city + '\\s+' + city, 'g');
      work = work.replace(dupe, city);
    }
    // 完整地址：去掉开头的城市名，保留区/街道等有效信息
    if (city && fullAddress && work.indexOf(city) === 0 && work.length > city.length + 1) {
      work = work.slice(city.length).replace(/^[\s,，]+/, '');
      result.steps.push('去掉重复的城市前缀');
    }

    result.trimmed = work;
    result.query = work;
    return result;
  }

  /**
   * 只保留到「楼栋/校区」层级：
   *   'XX大学 信息楼 305教室'      → 'XX大学 信息楼'
   *   '实验楼B座 5楼 智慧教室3'     → '实验楼B座'
   *   '南苑食堂门口'               → '南苑食堂'
   */
  function trimToBuilding(s) {
    var work = String(s || '');
    var ROOM_TAIL = new RegExp(
      '\\s*(?:'
      + '(?:教室|课室|机房|实验室|报告厅|阶梯教室|智慧教室|多媒体教室|多媒体|实验)\\s*\\d{0,4}'
      + '|[A-Za-z]?\\d{1,4}\\s*(?:教室|课室|室)?'
      + '|(?:实验|机房|教室)?\\s*[东西南北]?\\d{1,2}\\s*[-－]\\s*\\d{1,3}'
      + ')\\s*$');
    var FLOOR_TAIL = /\s*(?:\d{1,3}\s*(?:楼|层)|[一二三四五六七八九十]{1,3}\s*(?:楼|层))\s*$/;
    var PLACE_SUFFIX = /\s*(?:门口|门前|楼下|侧门|正门|大门口|集合点)\s*$/;
    var changed = true;
    var guard = 0;
    while (changed && guard++ < 8) {
      changed = false;
      var before = work;
      work = work.replace(PLACE_SUFFIX, '');
      work = work.replace(FLOOR_TAIL, '');
      work = work.replace(ROOM_TAIL, '');
      work = work.replace(/[-–—·・,，、]+$/g, '');
      work = work.replace(/\s+/g, ' ').trim();
      if (work !== before) { changed = true; }
    }
    return work;
  }

  /** 生成地图 App 的兜底链接（Windows / 浏览器） */
  function navWebUrl(query, pref) {
    var q = encodeURIComponent(query);
    if (pref === 'baidu') { return 'https://map.baidu.com/search/' + q; }
    if (pref === 'google') { return 'https://maps.google.com/?q=' + q; }
    return 'https://uri.amap.com/search?keyword=' + q;
  }

  /* ── JSON 导入合并（规划文档 §5.5） ──────────────────────── */

  function exportPayload() {
    var copy = deepCopy(state);
    copy.exportedAt = new Date().toISOString();
    copy.appVersion = APP_VERSION;
    copy.device = copy.device || {};
    if (AR.Bridge && AR.Bridge.deviceName) { copy.device.name = AR.Bridge.deviceName(); }
    if (AR.Bridge && AR.Bridge.platform) { copy.device.platform = AR.Bridge.platform(); }
    return copy;
  }

  function exportFileName() {
    var d = new Date();
    var name = (state.device && state.device.name) ? state.device.name.replace(/[\\/:*?"<>|\s]/g, '') : 'device';
    return 'AbbeyRoad-backup-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '-' + name + '.json';
  }

  /**
   * 计算合并预览：新增 / 更新 / 冲突 / 删除。
   * 采用「字段级新者胜 + 冲突清单」策略。
   */
  var MERGE_TABLES = ['semesters', 'teachers', 'locations', 'courses', 'blocks', 'overrides', 'events', 'reminders'];
  var REF_MAP_NAME = {
    semesters: 'semester', teachers: 'teacher', locations: 'location',
    courses: 'course', blocks: 'block', overrides: 'override'
  };

  function labelOfRecord(rec) {
    if (!rec) { return ''; }
    if (rec.name) { return rec.name; }
    if (rec.raw) { return rec.raw; }
    if (rec.title) { return rec.title; }
    if (rec.date) { return rec.date + (rec.start ? ' ' + rec.start : ''); }
    return rec.id || '';
  }

  /**
   * 跨设备合并的关键（v0.2.1）：两台设备各自生成过 id，同一门课 id 对不上，
   * 只按 id 合并就会「导出再导入 = 两份一模一样的课」。
   * 所以先按内容找同一条记录（学期看开学日期、老师看姓名、地点看原文、
   * 课程看课程名、时段看 课程+星期+节次+周次），找不到才算新增。
   */
  function naturalKeyOf(table, rec, maps) {
    if (!rec) { return null; }
    var cid, sem, bid;
    if (table === 'semesters') { return rec.startDate ? ('date:' + rec.startDate) : null; }
    if (table === 'teachers') { return rec.name ? ('name:' + String(rec.name).trim()) : null; }
    if (table === 'locations') { return rec.raw ? ('raw:' + String(rec.raw).trim()) : null; }
    if (table === 'courses') {
      sem = rec.semesterId && maps.semester ? (maps.semester[rec.semesterId] || rec.semesterId) : rec.semesterId;
      return rec.name ? ('name:' + String(rec.name).trim() + '|' + (sem || '')) : null;
    }
    if (table === 'blocks') {
      cid = rec.courseId && maps.course ? (maps.course[rec.courseId] || rec.courseId) : rec.courseId;
      return ['b', cid, rec.weekday, rec.periodStart, rec.periodEnd,
        rec.weekMode || 'all', (rec.weeks || []).join('.')].join('|');
    }
    if (table === 'overrides') {
      bid = rec.blockId && maps.block ? (maps.block[rec.blockId] || rec.blockId) : rec.blockId;
      return ['o', bid || rec.courseId, rec.date, rec.type].join('|');
    }
    if (table === 'events') { return ['e', rec.date, rec.type || '', rec.title || ''].join('|'); }
    return null;
  }

  /** 把外来记录里的关联 id 换成本地 id（跨设备这些 id 是不一样的） */
  function remapRecordRefs(table, rec, maps, keepId) {
    var out = {}, k;
    for (k in rec) { if (Object.prototype.hasOwnProperty.call(rec, k)) { out[k] = rec[k]; } }
    if (keepId) { out.id = keepId; }
    if (out.semesterId && maps.semester[out.semesterId]) { out.semesterId = maps.semester[out.semesterId]; }
    if (out.courseId && maps.course[out.courseId]) { out.courseId = maps.course[out.courseId]; }
    if (out.blockId && maps.block && maps.block[out.blockId]) { out.blockId = maps.block[out.blockId]; }
    if (Array.isArray(out.teacherIds)) {
      out.teacherIds = out.teacherIds.map(function (id) { return maps.teacher[id] || id; });
    }
    if (Array.isArray(out.locationIds)) {
      out.locationIds = out.locationIds.map(function (id) { return maps.location[id] || id; });
    }
    if (Array.isArray(out.newLocationIds)) {
      out.newLocationIds = out.newLocationIds.map(function (id) { return maps.location[id] || id; });
    }
    if (Array.isArray(out.newTeacherIds)) {
      out.newTeacherIds = out.newTeacherIds.map(function (id) { return maps.teacher[id] || id; });
    }
    return out;
  }

  /** 先算「要新增什么、要更新什么」，预览和真正合并共用同一份逻辑 */
  function planMerge(incoming) {
    var plan = { additions: [], updates: [], unknown: [], matched: 0, tombstones: [] };
    /**
     * 墓碑（删除记录）只统计「真的会删掉本机某条数据」的那些。
     * 导入自己刚导出的文件时，墓碑对应的记录早就删掉了，
     * 全算进来的话预览会写「删除 2」，看着像要误删东西。
     */
    var tombs = (incoming && incoming.tombstones) || [];
    for (var ti = 0; ti < tombs.length; ti++) {
      var tb = tombs[ti];
      var live = tb && tb.entity && Array.isArray(state[tb.entity]) ? state[tb.entity] : [];
      for (var li = 0; li < live.length; li++) {
        if (live[li].id === tb.id) { plan.tombstones.push(tb); break; }
      }
    }
    if (typeof incoming.schemaVersion === 'number' && incoming.schemaVersion > SCHEMA_VERSION) {
      plan.unknown.push('文件版本 ' + incoming.schemaVersion + ' 高于当前 App 支持的 ' + SCHEMA_VERSION + '，可能有字段被忽略');
    }
    var maps = plan.maps = { semester: {}, teacher: {}, location: {}, course: {}, block: {}, override: {} };
    for (var t = 0; t < MERGE_TABLES.length; t++) {
      var table = MERGE_TABLES[t];
      var mine = state[table] || [];
      var theirs = incoming[table] || [];
      var byId = {}, byKey = {}, i;
      for (i = 0; i < mine.length; i++) {
        byId[mine[i].id] = mine[i];
        var mk = naturalKeyOf(table, mine[i], maps);
        if (mk && !byKey[mk]) { byKey[mk] = mine[i]; }
      }
      var mapName = REF_MAP_NAME[table];
      for (i = 0; i < theirs.length; i++) {
        var rec = theirs[i];
        if (!rec || !rec.id) { continue; }
        var key = naturalKeyOf(table, rec, maps);
        var local = byId[rec.id];
        var target = local || ((!local && key && byKey[key]) ? byKey[key] : null);
        if (target) {
          if (mapName) { maps[mapName][rec.id] = target.id; }
          if (!local) { plan.matched++; }
          var lt = Date.parse(target.updatedAt || 0) || 0;
          var rt = Date.parse(rec.updatedAt || 0) || 0;
          if (rt > lt && JSON.stringify(rec) !== JSON.stringify(target)) {
            plan.updates.push({ table: table, id: target.id, rec: rec });
          }
        } else {
          if (mapName) { maps[mapName][rec.id] = rec.id; }
          if (key) { byKey[key] = rec; }
          plan.additions.push({ table: table, rec: rec });
        }
      }
    }
    collectNewTemplates(incoming, plan);
    return plan;
  }

  /** 提示词模板：按 id 去重，本地没见过的才加进来 */
  function collectNewTemplates(incoming, plan) {
    var theirs = incoming.promptTemplates;
    if (!Array.isArray(theirs) || !theirs.length) { return; }
    for (var i = 0; i < theirs.length; i++) {
      var rec = theirs[i];
      if (!rec || !rec.id) { continue; }
      var found = false;
      for (var j = 0; j < (state.promptTemplates || []).length; j++) {
        if (state.promptTemplates[j].id === rec.id) { found = true; break; }
      }
      if (!found) { plan.additions.push({ table: 'promptTemplates', rec: rec }); }
    }
  }

  function previewMerge(incoming) {
    if (!incoming || incoming.kind !== 'abbeyroad.sync') {
      throw new Error('文件不是 Abbey Road 同步文件（缺少 kind=abbeyroad.sync）');
    }
    var plan = planMerge(incoming);
    var report = {
      added: 0, updated: 0, conflicts: 0, removed: 0,
      unknown: plan.unknown, details: [], matched: plan.matched
    };
    var i;
    for (i = 0; i < plan.additions.length; i++) {
      if (plan.additions[i].table === 'promptTemplates') { continue; }
      report.added++;
      if (report.details.length < 40) {
        report.details.push({
          table: plan.additions[i].table, id: plan.additions[i].rec.id,
          action: 'add', label: labelOfRecord(plan.additions[i].rec)
        });
      }
    }
    for (i = 0; i < plan.updates.length; i++) {
      report.updated++;
      if (report.details.length < 40) {
        report.details.push({
          table: plan.updates[i].table, id: plan.updates[i].id,
          action: 'update', label: labelOfRecord(plan.updates[i].rec)
        });
      }
    }
    for (i = 0; i < plan.tombstones.length; i++) { report.removed++; }
    return report;
  }

  /** 应用合并（在预览后调用） */
  function applyMerge(incoming, options) {
    options = options || {};
    var plan = planMerge(incoming);
    var i, j;
    for (i = 0; i < plan.additions.length; i++) {
      var add = plan.additions[i];
      if (!Array.isArray(state[add.table])) { state[add.table] = []; }
      state[add.table].push(remapRecordRefs(add.table, add.rec, plan.maps, null));
    }
    for (i = 0; i < plan.updates.length; i++) {
      var up = plan.updates[i];
      var list = state[up.table] || [];
      for (j = 0; j < list.length; j++) {
        if (list[j].id === up.id) {
          list[j] = remapRecordRefs(up.table, up.rec, plan.maps, up.id);
          break;
        }
      }
    }
    if (options.preferIncoming) {
      // 「以对方为准」：同一条记录（含按内容匹配上的）全部用对方的字段覆盖
      for (i = 0; i < MERGE_TABLES.length; i++) {
        var table = MERGE_TABLES[i];
        var theirs = incoming[table];
        if (!Array.isArray(theirs)) { continue; }
        var mapName = REF_MAP_NAME[table];
        for (j = 0; j < theirs.length; j++) {
          var rec = theirs[j];
          if (!rec || !rec.id) { continue; }
          var mappedId = (mapName && plan.maps[mapName] && plan.maps[mapName][rec.id]) || rec.id;
          for (var m = 0; m < (state[table] || []).length; m++) {
            if (state[table][m].id === mappedId) {
              state[table][m] = remapRecordRefs(table, rec, plan.maps, mappedId);
              break;
            }
          }
        }
      }
    }
    // 设置：只合并白名单字段，避免把对方的设备相关设置带过来
    if (incoming.settings && options.mergeSettings !== false) {
      var keepKeys = ['integration', 'appearance', 'schedule', 'haptics'];
      for (var s = 0; s < keepKeys.length; s++) {
        var kk = keepKeys[s];
        if (incoming.settings[kk]) {
          var target = state.settings[kk] || {};
          for (var f in incoming.settings[kk]) {
            if (Object.prototype.hasOwnProperty.call(incoming.settings[kk], f) && target[f] === undefined) {
              target[f] = incoming.settings[kk][f];
            }
          }
          state.settings[kk] = target;
        }
      }
    }
    if (Array.isArray(incoming.tombstones)) {
      for (var t = 0; t < plan.tombstones.length; t++) { applyTombstone(plan.tombstones[t]); }
      state.tombstones = (state.tombstones || []).concat(incoming.tombstones);
    }
    // 对方的课表用到第 13 节甚至更晚：直接把节次表补齐，别让这些课「没有时间」
    syncPeriodsToUsage();
    // 合并完把「当前学期」纠偏：清空后再导入别人的配置时，别让界面继续空着
    var prefer = null;
    if (incoming.settings && incoming.settings.schedule) {
      prefer = incoming.settings.schedule.currentSemesterId || null;
      if (prefer && plan.maps && plan.maps.semester && plan.maps.semester[prefer]) {
        prefer = plan.maps.semester[prefer];
      }
    }
    ensureCurrentSemesterHasData(prefer);
    save(true);
    return state;
  }

  function applyTombstone(tomb) {
    if (!tomb || !tomb.entity) { return; }
    var list = state[tomb.entity];
    if (!Array.isArray(list)) { return; }
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].id === tomb.id) { list.splice(i, 1); }
    }
  }

  function markDeleted(entity, id) {
    state.tombstones = state.tombstones || [];
    state.tombstones.push({ id: id, entity: entity, deletedAt: new Date().toISOString() });
  }

  /* ── 输出 ─────────────────────────────────────────────────── */

  AR.Util = {
    uid: uid, pad2: pad2, dateKey: dateKey, timeKey: timeKey, parseDateKey: parseDateKey,
    startOfDay: startOfDay, addDays: addDays, addMinutes: addMinutes, sameDay: sameDay,
    daysBetween: daysBetween,
    weekdayOf: weekdayOf, mondayOf: mondayOf, hmToMinutes: hmToMinutes,
    minutesToHM: minutesToHM, clamp: clamp, escapeHtml: escapeHtml, deepCopy: deepCopy,
    debounce: debounce, WEEKDAY_NAMES: WEEKDAY_NAMES, PALETTE: PALETTE, colorHex: colorHex
  };

  AR.Const = {
    APP_VERSION: APP_VERSION, SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY, LAYOUT_KEY: LAYOUT_KEY,
    FMT_SEP: FMT_SEP, FMT_HEADER: FMT_HEADER
  };

  AR.Store = {
    load: load, save: save, get: get, reset: reset, migrate: migrate,
    currentSemester: currentSemester, periodsOf: periodsOf,
    courseById: courseById, teacherById: teacherById, locationById: locationById,
    blocksOfCourse: blocksOfCourse, overridesOfBlock: overridesOfBlock,
    blockById: blockById, overrideById: overrideById,
    ensureTeacherByName: ensureTeacherByName, ensureLocationByRaw: ensureLocationByRaw,
    parseWeeksText: parseWeeksText, weeksText: weeksText, compressWeeks: compressWeeks,
    updateBlock: updateBlock, removeBlock: removeBlock,
    upsertOverride: upsertOverride, removeOverride: removeOverride,
    ensurePeriodsFor: ensurePeriodsFor, syncPeriodsToUsage: syncPeriodsToUsage,
    ensureCurrentSemesterHasData: ensureCurrentSemesterHasData,
    blockCountOfSemester: blockCountOfSemester, semesterById: semesterById,
    claimPeriodsFor: claimPeriodsFor,
    semesterList: semesterList, setCurrentSemester: setCurrentSemester,
    courseCountOfSemester: courseCountOfSemester,
    addSemester: addSemester,
    eventsOf: eventsOf, eventsBetween: eventsBetween, eventsInWeek: eventsInWeek,
    saveEvent: saveEvent, removeEvent: removeEvent,
    renameCourse: renameCourse, unifyColorsByName: unifyColorsByName,
    EVENT_TYPES: EVENT_TYPES, eventType: eventType,
    exportPayload: exportPayload, exportFileName: exportFileName,
    previewMerge: previewMerge, applyMerge: applyMerge, markDeleted: markDeleted,
    defaultPeriodTimes: defaultPeriodTimes, makePeriods: makePeriods
  };

  AR.Schedule = {
    weekNumber: weekNumber, expandWeeks: expandWeeks, weeksLabel: weeksLabel,
    periodRange: periodRange, dayItems: dayItems, nextItem: nextItem,
    ongoingItem: ongoingItem, weekItems: weekItems, conflicts: conflicts,
    mergeConsecutive: mergeConsecutive, sameWeekSet: sameWeekSet, decorate: decorate
  };

  AR.Location = { navQuery: navQuery, navWebUrl: navWebUrl, normalizePlace: normalizePlace, trimToBuilding: trimToBuilding };
  AR.Prompt = { version: PROMPT_VERSION, text: PROMPT_TEXT };
})();
