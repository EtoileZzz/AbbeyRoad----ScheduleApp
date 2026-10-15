/* ──────────────────────────────────────────────────────────────
   Abbey Road · 固定 Markdown（MD-1）解析器
   规范见规划文档 §9：容错优先 + 逐条错误提示 + 冲突检测 + 连堂课合并
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  var U = null; // 延迟取 AR.Util（core.js 先加载）

  var SECTION_ALIAS = {
    semester: ['学期', '学期信息', '基本信息'],
    periods: ['节次表', '节次', '时间表', '作息', '作息时间'],
    courses: ['课程', '课程表', '授课', '上课安排', '课'],
    overrides: ['调课与停课', '调课', '调整', '停课补课', '变更', '调课停课']
  };

  var FIELD_ALIAS = {
    courseName: ['课程名', '课程', '课名', '科目', '名称', 'course'],
    teachers: ['老师', '教师', '授课教师', '任课教师', 'teacher'],
    place: ['地点', '教室', '上课地点', '场地', 'location', 'room'],
    weekday: ['星期', '周几', '星期几', 'weekday'],
    periods: ['节次', '节', '时间', '时段', 'period'],
    weeks: ['周次', '周数', '周', 'weeks'],
    parity: ['单双周', '周类型', '奇偶周', 'parity'],
    note: ['备注', '说明', 'note'],
    semName: ['学期名称', '名称'],
    semStart: ['开始日期', '开学日期', '起始日期', '日期'],
    semWeeks: ['总周数', '周数', '周次'],
    periodIndex: ['节次', '节', '序号'],
    periodStart: ['开始时间', '开始', '起始'],
    periodEnd: ['结束时间', '结束', '截止'],
    ovCourse: ['课程名', '课程'],
    ovDate: ['日期', '时间'],
    ovType: ['类型', '变动类型'],
    ovWeekday: ['新星期', '星期'],
    ovPeriods: ['新节次', '节次'],
    ovPlace: ['新地点', '地点'],
    ovReason: ['原因/备注', '原因', '备注']
  };

  /**
   * 每个区块只允许匹配自己那组字段。
   * 否则「课程名 / 日期 / 节次」这类同名列会在错误的分组里被抢先匹配，
   * 导致「调课与停课」表整表解析不出内容。
   */
  var KIND_FIELDS = {
    semester: ['semName', 'semStart', 'semWeeks'],
    periods: ['periodIndex', 'periodStart', 'periodEnd'],
    courses: ['courseName', 'teachers', 'place', 'weekday', 'periods', 'weeks', 'parity', 'note'],
    overrides: ['ovCourse', 'ovDate', 'ovType', 'ovWeekday', 'ovPeriods', 'ovPlace', 'ovReason']
  };

  var WEEKDAY_MAP = {
    '周一': 1, '星期一': 1, '礼拜一': 1, '周1': 1, '一': 1, 'mon': 1, 'monday': 1, '1': 1,
    '周二': 2, '星期二': 2, '礼拜二': 2, '周2': 2, '二': 2, 'tue': 2, 'tuesday': 2, '2': 2,
    '周三': 3, '星期三': 3, '礼拜三': 3, '周3': 3, '三': 3, 'wed': 3, 'wednesday': 3, '3': 3,
    '周四': 4, '星期四': 4, '礼拜四': 4, '周4': 4, '四': 4, 'thu': 4, 'thursday': 4, '4': 4,
    '周五': 5, '星期五': 5, '礼拜五': 5, '周5': 5, '五': 5, 'fri': 5, 'friday': 5, '5': 5,
    '周六': 6, '星期六': 6, '礼拜六': 6, '周6': 6, '六': 6, 'sat': 6, 'saturday': 6, '6': 6,
    '周日': 7, '周天': 7, '星期日': 7, '星期天': 7, '礼拜日': 7, '礼拜天': 7, '周7': 7, '日': 7, '天': 7,
    'sun': 7, 'sunday': 7, '7': 7
  };

  var TYPE_MAP = {
    '调课': 'move', '换时间': 'time', '换教室': 'room', '停课': 'cancel',
    '补课': 'makeup', '加课': 'add', '增加': 'add', '补': 'makeup', '停': 'cancel'
  };

  var EMPTY_VALUES = ['', '-', '—', '–', '?', '？', '无', '待定', 'null', 'none', 'n/a'];

  function isEmpty(v) {
    if (v == null) { return true; }
    var s = String(v).trim();
    for (var i = 0; i < EMPTY_VALUES.length; i++) { if (s === EMPTY_VALUES[i]) { return true; } }
    return false;
  }

  function norm(s) {
    return String(s == null ? '' : s).trim()
      .replace(/\*\*/g, '').replace(/`/g, '')
      .replace(/[（(]\s*[)）]/g, '').trim();
  }

  /** 去掉 AI 可能加的代码块围栏与前后寒暄 */
  function stripFences(text) {
    var t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    t = t.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '$1');
    return t;
  }

  /** 按 H2 切区块 */
  function splitSections(text) {
    var lines = text.split('\n');
    var order = [];
    var map = {};
    var cur = '_head';
    map[cur] = [];
    order.push(cur);
    for (var i = 0; i < lines.length; i++) {
      var m = /^\s{0,3}#{2,3}\s*(.+?)\s*$/.exec(lines[i]);
      if (m) {
        var title = norm(m[1]);
        var key = null;
        // 最长别名优先：否则「课」会把「调课与停课」误判成课程区块
        var bestLen = 0;
        for (var k in SECTION_ALIAS) {
          if (!Object.prototype.hasOwnProperty.call(SECTION_ALIAS, k)) { continue; }
          for (var j = 0; j < SECTION_ALIAS[k].length; j++) {
            var alias = SECTION_ALIAS[k][j];
            if (title.indexOf(alias) >= 0 && alias.length > bestLen) {
              key = k;
              bestLen = alias.length;
            }
          }
        }
        cur = key || ('_skip_' + i);
        if (!map[cur]) { map[cur] = []; order.push(cur); }
        continue;
      }
      if (map[cur]) { map[cur].push(lines[i]); }
    }
    var out = {};
    for (var o = 0; o < order.length; o++) {
      if (order[o].charAt(0) !== '_' || order[o] === '_head') { out[order[o]] = map[order[o]]; }
    }
    return out;
  }

  /** 解析 markdown 表格 → {header:[], rows:[[]]} */
  function parseTable(lines) {
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('|') !== 0 && line.indexOf('|') < 0) { continue; }
      if (line.replace(/[|\s:-]/g, '') === '') { continue; } // 分隔行
      var cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
      for (var c = 0; c < cells.length; c++) { cells[c] = norm(cells[c]); }
      rows.push(cells);
    }
    if (!rows.length) { return { header: [], rows: [] }; }
    return { header: rows[0], rows: rows.slice(1) };
  }

  /** 表头 → 字段名索引 */
  function mapColumns(header, kind, issues) {
    var map = {};
    var unknown = [];
    var fields = KIND_FIELDS[kind] || [];
    for (var i = 0; i < header.length; i++) {
      var h = header[i];
      var field = null;
      for (var fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        var aliases = FIELD_ALIAS[f];
        if (!aliases) { continue; }
        for (var a = 0; a < aliases.length; a++) {
          if (h && h.indexOf(aliases[a]) >= 0) { field = f; break; }
        }
        if (field) { break; }
      }
      if (field) {
        if (map[field] === undefined) { map[field] = i; }
      } else if (h) {
        unknown.push(h);
      }
    }
    if (unknown.length && issues) {
      issues.push({ code: 'W120', level: 'warn', message: '表中有未识别的列：' + unknown.join('、') + '（已忽略）' });
    }
    return map;
  }

  function cell(row, idx) {
    if (idx === undefined || idx == null || idx < 0) { return ''; }
    return row[idx] === undefined ? '' : row[idx];
  }

  /** 表头是否像课程表（决定走"按列名映射"还是"按内容猜字段"） */
  function hasCourseHeader(header) {
    if (!header || !header.length) { return false; }
    var hit = 0;
    for (var i = 0; i < header.length; i++) {
      var h = String(header[i] || '');
      if (!h) { continue; }
      for (var fi = 0; fi < KIND_FIELDS.courses.length; fi++) {
        var aliases = FIELD_ALIAS[KIND_FIELDS.courses[fi]] || [];
        for (var a = 0; a < aliases.length; a++) {
          if (h.indexOf(aliases[a]) >= 0) { hit++; a = aliases.length; fi = KIND_FIELDS.courses.length; break; }
        }
      }
    }
    return hit >= 2;   // 至少两列对得上才算标准表头
  }

  function hasOverrideHeader(header) {
    if (!header || !header.length) { return false; }
    var hit = 0;
    for (var i = 0; i < header.length; i++) {
      var h = String(header[i] || '');
      if (!h) { continue; }
      for (var fi = 0; fi < KIND_FIELDS.overrides.length; fi++) {
        var aliases = FIELD_ALIAS[KIND_FIELDS.overrides[fi]] || [];
        for (var a = 0; a < aliases.length; a++) {
          if (h.indexOf(aliases[a]) >= 0) { hit++; a = aliases.length; fi = KIND_FIELDS.overrides.length; break; }
        }
      }
    }
    return hit >= 2;
  }

  /* ── 字段解析 ─────────────────────────────────────────────── */

  function parseWeekday(s) {
    var v = norm(s).toLowerCase().replace(/\s/g, '');
    if (!v) { return null; }
    if (WEEKDAY_MAP[v] !== undefined) { return WEEKDAY_MAP[v]; }
    // 兼容「周一/1」「星期三(3)」
    var m = /(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/.exec(v);
    if (m) {
      var t = m[1].replace('日', '天');
      var key = t === '天' ? '周日' : ('周' + t);
      if (WEEKDAY_MAP[key] !== undefined) { return WEEKDAY_MAP[key]; }
    }
    return null;
  }

  /**
   * 节次解析：'1-2' / '第1-2节' / '1,3' / '5' / '1~2'
   * 返回 { segments: [[s,e],…], start, end } 或 null
   */
  function parsePeriods(s) {
    var v = norm(s).replace(/第/g, '').replace(/节/g, '').replace(/\s/g, '');
    if (isEmpty(v)) { return null; }
    v = v.replace(/[~～—–－至]/g, '-').replace(/[、,，;；]/g, ',');
    var segments = [];
    var parts = v.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) { continue; }
      var mm = /^(\d+)\s*-\s*(\d+)$/.exec(p);
      if (mm) {
        var a = Number(mm[1]), b = Number(mm[2]);
        if (b < a) { var tmp = a; a = b; b = tmp; }
        segments.push([a, b]);
      } else if (/^\d+$/.test(p)) {
        segments.push([Number(p), Number(p)]);
      } else {
        return null;
      }
    }
    if (!segments.length) { return null; }
    segments.sort(function (x, y) { return x[0] - y[0]; });
    return { segments: segments, start: segments[0][0], end: segments[segments.length - 1][1] };
  }

  /**
   * 周次解析：'1-16' / '第1-16周' / '1,3,5-7' / '全周' / '单周' / '双周' / '1-16周(单)'
   * 返回 { weeks:[], mode:'all'|'odd'|'even'|'custom', parityHint:null|'odd'|'even' }
   */
  function parseWeeks(s, weekCount) {
    var raw = norm(s);
    if (isEmpty(raw)) { return null; }
    var n = weekCount || 20;
    var out = { weeks: [], mode: 'custom', parityHint: null };
    var hasOdd = /单/.test(raw), hasEven = /双/.test(raw);
    if (hasOdd && hasEven) { out.parityHint = 'both'; }
    else if (hasOdd) { out.parityHint = 'odd'; }
    else if (hasEven) { out.parityHint = 'even'; }

    if (/全周|每周|全部|所有/.test(raw)) { out.mode = 'all'; out.weeks = range(1, n); return out; }

    // 只保留数字与分隔符，其余字符（周/第/单/双/括号等）全部丢掉
    var v = raw.replace(/[^\d,，、~～—–－至\-]/g, '')
      .replace(/[，、]/g, ',')
      .replace(/[~～—–－至]/g, '-')
      .replace(/-+/g, '-')
      .replace(/,+/g, ',')
      .replace(/^[\s,\-]+|[\s,\-]+$/g, '');

    if (!v) {
      if (out.parityHint === 'odd') { out.mode = 'odd'; out.weeks = oddWeeks(n); return out; }
      if (out.parityHint === 'even') { out.mode = 'even'; out.weeks = evenWeeks(n); return out; }
      if (out.parityHint === 'both') { out.mode = 'all'; out.weeks = range(1, n); return out; }
      return null;
    }

    var weeks = [];
    var parts = v.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) { continue; }
      var mm = /^(\d+)\s*-\s*(\d+)$/.exec(p);
      if (mm) {
        var a = Number(mm[1]), b = Number(mm[2]);
        if (b < a) { var t = a; a = b; b = t; }
        for (var w = a; w <= b; w++) { weeks.push(w); }
      } else if (/^\d+$/.test(p)) {
        weeks.push(Number(p));
      } else {
        return null;
      }
    }
    if (!weeks.length) { return null; }
    weeks.sort(function (x, y) { return x - y; });
    // 去重
    var uniq = [];
    for (var u = 0; u < weeks.length; u++) { if (uniq.indexOf(weeks[u]) < 0) { uniq.push(weeks[u]); } }
    out.weeks = uniq;
    if (out.parityHint === 'odd') {
      var odd = [];
      for (var o = 0; o < uniq.length; o++) { if (uniq[o] % 2 === 1) { odd.push(uniq[o]); } }
      out.mode = 'custom';
      out.weeks = odd.length ? odd : uniq;
    } else if (out.parityHint === 'even') {
      var even = [];
      for (var e = 0; e < uniq.length; e++) { if (uniq[e] % 2 === 0) { even.push(uniq[e]); } }
      out.mode = 'custom';
      out.weeks = even.length ? even : uniq;
    }
    return out;
  }

  function parseParity(s) {
    var v = norm(s);
    if (!v) { return null; }
    if (v.indexOf('单') >= 0 && v.indexOf('双') >= 0) { return 'both'; }
    if (v.indexOf('单') >= 0) { return 'odd'; }
    if (v.indexOf('双') >= 0) { return 'even'; }
    if (v.indexOf('全') >= 0 || v.indexOf('每') >= 0) { return 'all'; }
    return null;
  }

  function parseDateLoose(s, fallbackYear) {
    var v = norm(s);
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
    if (m) { return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]); }
    m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(v);
    if (m && fallbackYear) { return fallbackYear + '-' + pad(m[1]) + '-' + pad(m[2]); }
    m = /^(\d{1,2})月(\d{1,2})日?$/.exec(v);
    if (m && fallbackYear) { return fallbackYear + '-' + pad(m[1]) + '-' + pad(m[2]); }
    return null;
  }

  function pad(n) { n = Number(n); return n < 10 ? '0' + n : '' + n; }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) { r.push(i); } return r; }
  function oddWeeks(n) { var r = []; for (var i = 1; i <= n; i += 2) { r.push(i); } return r; }
  function evenWeeks(n) { var r = []; for (var i = 2; i <= n; i += 2) { r.push(i); } return r; }

  /* ── 主解析入口 ───────────────────────────────────────────── */

  function parse(text, opts) {
    U = AR.Util;
    opts = opts || {};
    var raw = stripFences(text || '');
    var sections = splitSections(raw);
    var issues = [];
    var result = {
      semester: null,
      periods: [],
      rows: [],
      overrides: [],
      events: [],
      issues: issues,
      summary: { courses: 0, periods: 0, overrides: 0, events: 0, errors: 0, warnings: 0, conflicts: 0, merged: 0 }
    };

    if (!raw.trim()) {
      issues.push({ code: 'E000', level: 'error', message: '还没有内容：请把 AI 生成的 Markdown 粘贴进来。' });
      result.summary.errors = 1;
      return result;
    }

    // 首选：自定义文本格式（一行一门课，竖线分隔）
    var ar = looksLikeArTxt(raw) ? parseArTxt(raw, opts) : null;

    /* 学期 */
    if (sections.semester) {
      var t = parseTable(sections.semester);
      if (t.rows.length) {
        var cm = mapColumns(t.header, 'semester', issues);
        var r0 = t.rows[0];
        var name = cell(r0, cm.semName);
        var start = cell(r0, cm.semStart);
        var wc = cell(r0, cm.semWeeks);
        result.semester = {
          name: isEmpty(name) ? '' : name,
          startDate: parseDateLoose(start, new Date().getFullYear()),
          weekCount: isEmpty(wc) ? null : (parseInt(wc, 10) || null)
        };
        if (!result.semester.startDate) {
          issues.push({ code: 'W105', level: 'warn', message: '学期开始日期缺失或无法识别，导入后请在设置里补上（否则"第几周"会不准）。' });
        }
      }
    }
    // AR-TXT 的元信息行 / 导入页选项 / 宽松的「开学日期：…」行
    if (!result.semester && ar && (ar.meta.startDate || ar.meta.weekCount || ar.meta.name)) {
      result.semester = {
        name: ar.meta.name || '',
        startDate: ar.meta.startDate || null,
        weekCount: ar.meta.weekCount || null
      };
    }
    if (!result.semester && opts.semester && (opts.semester.startDate || opts.semester.name)) {
      result.semester = {
        name: opts.semester.name || '',
        startDate: opts.semester.startDate || null,
        weekCount: opts.semester.weekCount || null
      };
    }
    if (!result.semester) {
      var mStart = /开学(?:日期|时间)\s*[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})/.exec(raw);
      var mWeeks = /总周数\s*[:：]?\s*(\d{1,2})/.exec(raw);
      if (mStart || mWeeks) {
        result.semester = {
          name: '',
          startDate: mStart ? parseDateLoose(mStart[1], new Date().getFullYear()) : null,
          weekCount: mWeeks ? (parseInt(mWeeks[1], 10) || null) : null
        };
      }
    }

    /* 节次表 */
    if (sections.periods) {
      var tp = parseTable(sections.periods);
      var pm = mapColumns(tp.header, 'periods', issues);
      for (var i = 0; i < tp.rows.length; i++) {
        var row = tp.rows[i];
        var idx = parseInt(cell(row, pm.periodIndex), 10);
        var st = cell(row, pm.periodStart);
        var en = cell(row, pm.periodEnd);
        if (!idx) { continue; }
        if (isEmpty(st) && isEmpty(en)) { continue; }
        if (!/^\d{1,2}:\d{2}$/.test(st) || !/^\d{1,2}:\d{2}$/.test(en)) {
          issues.push({ code: 'W103', level: 'warn', message: '节次表第 ' + idx + ' 节时间格式不是 HH:mm，已忽略该行。' });
          continue;
        }
        result.periods.push({ index: idx, start: st, end: en, label: '第' + idx + '节' });
      }
      result.summary.periods = result.periods.length;
    }

    var weekCount = (result.semester && result.semester.weekCount) || opts.weekCount || 20;

    /* 课程解析顺序：
       ① 有表头的表格（旧 Markdown / Excel 粘贴）→ 按列名映射，列序任意
       ② 自定义文本格式 AR-TXT → 按固定顺序
       ③ JSON 数组
       ④ 无表头表格 → 按内容猜
       ⑤ 整篇宽松扫描
    */
    var mdTable = sections.courses ? parseTable(sections.courses) : null;
    var mdHasHeader = !!(mdTable && mdTable.rows.length && hasCourseHeader(mdTable.header));
    var jsonRows = null;

    if (mdHasHeader) {
      var ccm = mapColumns(mdTable.header, 'courses', issues);
      for (var c = 0; c < mdTable.rows.length; c++) {
        if (!mdTable.rows[c] || !mdTable.rows[c].length) { continue; }
        result.rows.push(parseCourseRow(mdTable.rows[c], ccm, c, weekCount, opts));
      }
    } else if (ar && ar.rows.length) {
      for (var ai = 0; ai < ar.rows.length; ai++) {
        result.rows.push(finishRow(ar.rows[ai], ai, weekCount, opts));
      }
      issues.push({
        code: 'W121', level: 'info',
        message: '按自定义文本格式识别到 ' + ar.rows.length + ' 条课程。'
      });
    } else if ((jsonRows = tryJsonRows(raw))) {
      for (var jr = 0; jr < jsonRows.length; jr++) {
        result.rows.push(finishRow(jsonRows[jr], jr, weekCount, opts));
      }
      issues.push({ code: 'W121', level: 'info', message: '按 JSON 格式识别到 ' + jsonRows.length + ' 条课程。' });
    } else if (mdTable && mdTable.rows.length) {
      // 有表格但没有可识别的表头：按每格内容猜
      for (var c2 = 0; c2 < mdTable.rows.length; c2++) {
        var rowArr = mdTable.rows[c2];
        if (!rowArr || !rowArr.length) { continue; }
        var lf = parseLooseLine(rowArr.join(' | '), true);
        if (lf) { result.rows.push(finishRow(lf, c2, weekCount, opts)); }
      }
    } else {
      var loose = parseLooseText(raw);
      for (var lr = 0; lr < loose.length; lr++) {
        result.rows.push(finishRow(loose[lr].fields, loose[lr].lineNo, weekCount, opts));
      }
      if (!loose.length) {
        issues.push({
          code: 'E002', level: 'error',
          message: '没有识别到课程。一行一门课（字段用 ｜ 分隔）就可以，请把 AI 输出的整段内容粘进来。'
        });
      } else {
        issues.push({
          code: 'W121', level: 'info',
          message: '按通用格式识别到 ' + loose.length + ' 条课程（没有使用标准分隔符，已自动对齐字段）。'
        });
      }
    }

    /* 调课与停课：AR-TXT → 标准表格 → 宽松逐行 */
    if (ar && ar.overrides.length) {
      for (var aov = 0; aov < ar.overrides.length; aov++) {
        var arow = ar.overrides[aov];
        if (arow.dateRaw) { arow.dateRaw = parseDateLoose(arow.dateRaw, new Date().getFullYear()) || arow.dateRaw; }
        finishOverride(arow);
        result.overrides.push(arow);
      }
    } else if (sections.overrides) {
      var to = parseTable(sections.overrides);
      if (to.rows.length && hasOverrideHeader(to.header)) {
        var ocm = mapColumns(to.header, 'overrides', issues);
        for (var o = 0; o < to.rows.length; o++) {
          var ov = parseOverrideRow(to.rows[o], ocm, o);
          if (ov) { result.overrides.push(ov); }
        }
      }
    }
    if (!result.overrides.length) {
      var looseOv = parseLooseOverrides(raw);
      for (var lo = 0; lo < looseOv.length; lo++) {
        result.overrides.push(looseOv[lo]);
      }
    }

    /* 全局错误/警告汇总 */
    for (var r = 0; r < result.rows.length; r++) {
      var it = result.rows[r];
      for (var e = 0; e < it.issues.length; e++) {
        it.issues[e].rowIndex = r;
        issues.push(it.issues[e]);
      }
    }
    for (var ov2 = 0; ov2 < result.overrides.length; ov2++) {
      var oit = result.overrides[ov2];
      for (var e2 = 0; e2 < oit.issues.length; e2++) {
        oit.issues[e2].rowIndex = ov2;
        oit.issues[e2].rowKind = 'override';
        issues.push(oit.issues[e2]);
      }
    }

    /* 冲突检测（C200 / C210 / C220） */
    result.conflicts = detectConflicts(result.rows, weekCount);
    for (var cf = 0; cf < result.conflicts.length; cf++) { issues.push(result.conflicts[cf]); }

    result.summary.courses = result.rows.length;
    result.summary.overrides = result.overrides.length;
    if (ar && ar.events && ar.events.length) {
      result.events = ar.events.filter(function (e) { return !!e.date; });
      result.summary.events = result.events.length;
      issues.push({
        code: 'W130', level: 'info',
        message: '识别到 ' + result.events.length + ' 条特殊事件（考试 / 讲座 / 活动），会按日期显示在本周概览里。'
      });
    } else {
      result.events = [];
      result.summary.events = 0;
    }
    for (var s = 0; s < issues.length; s++) {
      if (issues[s].level === 'error') { result.summary.errors++; }
      else if (issues[s].level === 'warn') { result.summary.warnings++; }
      else if (issues[s].level === 'conflict') { result.summary.conflicts++; }
    }
    return result;
  }

  /** 字段对象 → 行对象（表格路径与宽松路径共用同一套校验逻辑） */
  function finishRow(f, lineNo, weekCount, opts) {
    opts = opts || {};
    var it = {
      lineNo: lineNo + 1,
      courseName: String(f.courseName || '').trim(),
      teachersRaw: String(f.teachersRaw || '').trim(),
      place: String(f.place || '').trim(),
      weekdayRaw: String(f.weekdayRaw || '').trim(),
      periodsRaw: String(f.periodsRaw || '').trim(),
      weeksRaw: String(f.weeksRaw || '').trim(),
      parityRaw: String(f.parityRaw || '').trim(),
      note: String(f.note || '').trim(),
      color: f.color || null,
      weekday: null, periodSegments: null, weeks: null, weekMode: 'custom',
      parity: null, issues: []
    };

    if (isEmpty(it.courseName)) {
      it.issues.push({ code: 'E001', level: 'error', message: '第 ' + it.lineNo + ' 行：课程名为空，请补上后再导入。' });
    }

    it.weekday = parseWeekday(it.weekdayRaw);
    if (!it.weekday) {
      it.issues.push({ code: 'E010', level: 'error', message: '第 ' + it.lineNo + ' 行：星期无法识别（“' + it.weekdayRaw + '”）。' });
    }

    it.periodSegments = parsePeriods(it.periodsRaw);
    if (!it.periodSegments) {
      it.issues.push({ code: 'E020', level: 'error', message: '第 ' + it.lineNo + ' 行：节次无法解析（“' + it.periodsRaw + '”）。' });
    } else {
      var maxP = it.periodSegments.end;
      if (maxP > 20 || it.periodSegments.start < 1) {
        it.issues.push({ code: 'E020', level: 'error', message: '第 ' + it.lineNo + ' 行：节次超出范围（' + it.periodsRaw + '）。' });
        it.periodSegments = null;
      }
    }

    it.weeks = parseWeeks(it.weeksRaw, weekCount);
    if (!it.weeks) {
      if (isEmpty(it.weeksRaw)) {
        // 没写周次时：优先用导入页选的默认单双周，否则按"全周"
        var dp = opts.defaultParity;
        if (dp === 'odd' || dp === 'even') {
          it.weeks = {
            weeks: dp === 'odd' ? oddWeeks(weekCount || 20) : evenWeeks(weekCount || 20),
            mode: dp, parityHint: dp
          };
          it.weekMode = dp;
          it.issues.push({
            code: 'W141', level: 'warn',
            message: '第 ' + it.lineNo + ' 行：没写周次，已按导入设置「' + (dp === 'odd' ? '单周' : '双周') + '」处理。'
          });
        } else {
          it.weeks = { weeks: range(1, weekCount || 20), mode: 'all', parityHint: null };
          it.issues.push({ code: 'W140', level: 'warn', message: '第 ' + it.lineNo + ' 行：没写周次，已按「全周」处理。' });
        }
      } else {
        it.issues.push({ code: 'E030', level: 'error', message: '第 ' + it.lineNo + ' 行：周次无法解析（“' + it.weeksRaw + '”）。' });
      }
    }

    it.parity = parseParity(it.parityRaw);
    if (it.weeks && it.parity && it.parity !== 'all' && it.parity !== 'both') {
      if (it.weeks.parityHint && it.weeks.parityHint !== it.parity) {
        it.issues.push({
          code: 'W102', level: 'warn',
          message: '第 ' + it.lineNo + ' 行：周次里的单双周与“单双周”列不一致，已按“单双周”列处理。'
        });
      }
      var filtered = [];
      for (var i = 0; i < it.weeks.weeks.length; i++) {
        var w = it.weeks.weeks[i];
        if (it.parity === 'odd' && w % 2 === 0) { continue; }
        if (it.parity === 'even' && w % 2 === 1) { continue; }
        filtered.push(w);
      }
      it.weeks.weeks = filtered;
      it.weekMode = 'custom';
    } else if (it.weeks) {
      it.weekMode = it.weeks.mode;
    }

    if (isEmpty(it.place)) {
      it.issues.push({ code: 'W100', level: 'warn', message: '第 ' + it.lineNo + ' 行：缺少地点（可导入后补全，导航会不可用）。' });
    }
    if (isEmpty(it.teachersRaw)) {
      it.issues.push({ code: 'W101', level: 'warn', message: '第 ' + it.lineNo + ' 行：缺少老师信息。' });
    }
    if (/需确认/.test(it.note || '')) {
      it.issues.push({ code: 'W130', level: 'warn', message: '第 ' + it.lineNo + ' 行：备注里标了「需确认」，建议核对后再用。' });
    }
    return it;
  }

  function parseCourseRow(row, cm, lineNo, weekCount, opts) {
    return finishRow({
      courseName: cell(row, cm.courseName),
      teachersRaw: cell(row, cm.teachers),
      place: cell(row, cm.place),
      weekdayRaw: cell(row, cm.weekday),
      periodsRaw: cell(row, cm.periods),
      weeksRaw: cell(row, cm.weeks),
      parityRaw: cell(row, cm.parity),
      note: cell(row, cm.note)
    }, lineNo, weekCount, opts);
  }

  /* ── 宽松解析：不管 AI 用什么格式，尽量还原成课程行 ─────────── */

  var RE_MARK_WEEKDAY = /(?:周|星期|礼拜)[一二三四五六日天1-7]/;
  var RE_MARK_PERIOD = /(?:第\s*\d{1,2}\s*节|\d{1,2}\s*[-~～—–－,、]\s*\d{1,2}\s*节)/;
  var RE_MARK_WEEKS = /(?:\d{1,2}\s*[-~～—–－]\s*\d{1,2}\s*周|\d{1,2}\s*周|(?:单|双|全|每)周)/;
  var RE_PARITY_ONLY = /^(?:单周|双周|全周|每周|单双周)$/;
  var RE_PLACE_HINT = /(楼|馆|室|场|校区|大学|学院|中心|号|路|街|道|层|机房|实验室|报告厅|阶梯|线上|会议|直播|腾讯|钉钉|zoom|Room|Lab)/i;
  var RE_TEACHER_HINT = /(老师|教师|教授|导师)/;
  var RE_NUM_RANGE = /^\d{1,2}\s*[-~～—–－,、]\s*\d{1,2}$/;
  var RE_NUM_ONE = /^\d{1,2}$/;
  // 数字列表：1 / 1-2 / 1,3 / 1-8,10-16 / 1、3、5-7
  var RE_NUM_LIST = /^\d{1,2}(?:\s*[-~～—–－]\s*\d{1,2})?(?:\s*[,、]\s*\d{1,2}(?:\s*[-~～—–－]\s*\d{1,2})?)*$/;

  function splitLoose(line) {
    var s = String(line || '')
      .replace(/^\s*[-*•·●○]\s*/, '')
      .replace(/^\s*\d+\s*[.、)）]\s*/, '')
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .trim();
    if (!s) { return []; }
    if (s.indexOf('|') >= 0) { return s.split('|'); }
    if (s.indexOf('\t') >= 0) { return s.split('\t'); }
    if (/\s{2,}/.test(s)) { return s.split(/\s{2,}/); }
    if (/[;；]/.test(s)) { return s.split(/[;；]/); }
    if (/[，,]/.test(s)) {
      var byComma = s.split(/[，,]/);
      if (byComma.length >= 4) { return byComma; }
    }
    if (/\s/.test(s)) {
      var bySpace = s.split(/\s+/);
      // 单个空格也拆，但要求拆出来不太碎（避免把「XX大学 信息楼 305」拆散后又拼回去）
      if (bySpace.length >= 3) { return bySpace; }
    }
    return [s];
  }

  /** 把「周一1-2节」这类黏在一起的写法拆开 */
  function splitEmbedded(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = String(tokens[i] == null ? '' : tokens[i]).trim();
      if (!t) { continue; }
      var marks = [];
      var m = RE_MARK_WEEKDAY.exec(t);
      if (m) { marks.push(m); }
      m = RE_MARK_PERIOD.exec(t);
      if (m && (!marks.length || m.index !== marks[0].index)) { marks.push(m); }
      m = RE_MARK_WEEKS.exec(t);
      if (m) { marks.push(m); }
      if (!marks.length || t.length <= 4) { out.push(t); continue; }
      marks.sort(function (a, b) { return a.index - b.index; });
      var cursor = 0;
      for (var k = 0; k < marks.length; k++) {
        var mk = marks[k];
        if (mk.index < cursor) { continue; }
        if (mk.index > cursor) { out.push(t.slice(cursor, mk.index).trim()); }
        out.push(mk[0].trim());
        cursor = mk.index + mk[0].length;
      }
      if (cursor < t.length) { out.push(t.slice(cursor).trim()); }
    }
    return out.filter(function (x) { return !!x; });
  }

  function numbersOf(t) {
    var m = t.match(/\d{1,2}/g) || [];
    return m.map(function (x) { return Number(x); });
  }

  function isPeriodish(t) {
    if (/节/.test(t)) { return /^\s*第?\s*\d{1,2}\s*(?:[-~～—–－,、]\s*\d{1,2})*\s*节\s*$/.test(t); }
    if (!RE_NUM_LIST.test(t)) { return false; }
    var ns = numbersOf(t);
    var max = Math.max.apply(null, ns);
    var min = Math.min.apply(null, ns);
    return min >= 1 && max <= 15;
  }

  function isWeeksish(t) {
    if (/周/.test(t)) { return true; }
    if (!RE_NUM_LIST.test(t)) { return false; }
    var ns = numbersOf(t);
    return Math.max.apply(null, ns) >= 13;
  }

  function isPlaceLike(t) {
    return RE_PLACE_HINT.test(t);
  }

  /**
   * 把一行里的各个字段猜出来。
   * 依赖「课程名 → 星期 → 节次 → 周次 → 地点 → 老师」的常见顺序做弱顺序判断。
   */
  function classifyTokens(tokens) {
    var f = {
      courseName: '', teachersRaw: '', place: '', weekdayRaw: '',
      periodsRaw: '', weeksRaw: '', parityRaw: '', note: ''
    };
    var pending = [];
    var placeParts = [];
    var numericSeen = 0;

    for (var i = 0; i < tokens.length; i++) {
      var t = String(tokens[i] == null ? '' : tokens[i]).trim().replace(/^[，,、]+|[，,、]+$/g, '');
      if (!t) { continue; }
      if (isEmpty(t) && t !== '?') { continue; }

      if (!f.weekdayRaw && RE_MARK_WEEKDAY.test(t) && t.length <= 8) {
        f.weekdayRaw = t;
        continue;
      }
      if (RE_PARITY_ONLY.test(t) && !f.weeksRaw) {
        f.weeksRaw = t;              // 「单周 / 双周 / 全周」直接当周次用
        continue;
      }
      if (!f.periodsRaw && numericSeen === 0 && isPeriodish(t)) {
        f.periodsRaw = t; numericSeen++; continue;
      }
      if (!f.weeksRaw && isWeeksish(t)) { f.weeksRaw = t; continue; }
      if (!f.periodsRaw && isPeriodish(t)) { f.periodsRaw = t; numericSeen++; continue; }
      if (isPlaceLike(t)) { placeParts.push(t); continue; }
      pending.push(t);
    }

    if (placeParts.length) { f.place = placeParts.join(' '); }

    // 未分类的按顺序落位：第一个是课程名，带「老师」字样的 / 第二个是老师，其余算备注
    var teacherIdx = -1;
    for (var p = 0; p < pending.length; p++) {
      if (RE_TEACHER_HINT.test(pending[p])) { teacherIdx = p; break; }
    }
    if (teacherIdx >= 0) { f.teachersRaw = pending.splice(teacherIdx, 1)[0]; }
    if (pending.length) { f.courseName = pending.shift(); }
    if (!f.teachersRaw && pending.length && pending[0].length <= 12 && !/^\d+$/.test(pending[0])) {
      f.teachersRaw = pending.shift();
    }
    if (pending.length) { f.note = pending.join(' '); }
    return f;
  }

  /**
   * 解析一行（表格式、逗号分隔、空格分隔、列表项都能处理）。
   * requireWeekday=true 时，识别不到星期就返回 null（用于全篇扫描，避免把标题当课程）。
   */
  function parseLooseLine(line, requireWeekday) {
    var tokens = splitEmbedded(splitLoose(line));
    if (!tokens.length) { return null; }
    var f = classifyTokens(tokens);
    if (requireWeekday && !f.weekdayRaw) { return null; }
    if (!f.courseName && !f.weekdayRaw) { return null; }
    return f;
  }

  /* ── 自定义文本格式 AR-TXT v1 ─────────────────────────────────
     一行一门课，字段用全角竖线 ｜（或半角 |）分隔，顺序固定：
       课程名 ｜ 星期 ｜ 节次 ｜ 周次 ｜ 地点 ｜ 老师 ｜ 备注
     另有元信息行（开学日期：… / 总周数：… / 学期：…）与变动行：
       调课 ｜ 课程名 ｜ 日期 ｜ 新星期 ｜ 新节次 ｜ 新地点 ｜ 原因
       停课 ｜ 课程名 ｜ 日期
     好处：不依赖 Markdown 表格，复制粘贴时不会被对齐/补行搞坏。
     ──────────────────────────────────────────────────────────── */

  var AR_SEP_RE = /[｜|‖│❘]/;
  var AR_TYPE_WORDS = {
    '调课': 'move', '换时间': 'time', '换教室': 'room',
    '停课': 'cancel', '补课': 'makeup', '加课': 'add', '变动': 'move'
  };

  /** 特殊事件（考试 / 讲座 / 活动…）：单独一张表，按日期显示 */
  var EVENT_WORDS = {
    '考试': 'exam', '期中': 'exam', '期末': 'exam', 'exam': 'exam',
    '讲座': 'lecture', '报告': 'lecture', 'lecture': 'lecture',
    '活动': 'activity', '比赛': 'activity', '赛事': 'activity', 'activity': 'activity',
    '事件': 'other', '其他': 'other', 'event': 'other'
  };

  /** 事件行：类型 ｜ 标题 ｜ 日期 ｜ 时间 ｜ 地点 ｜ 备注（缺字段会自动找日期） */
  function parseEventFields(typeKey, fields) {
    var get = function (i) { return String(fields[i] == null ? '' : fields[i]).trim(); };
    var title = get(1), dateRaw = get(2), timeRaw = get(3), place = get(4), note = get(5);
    if (!parseDateLoose(dateRaw, new Date().getFullYear())) {
      for (var i = 2; i <= 4; i++) {
        if (parseDateLoose(get(i), new Date().getFullYear())) {
          var rest = [];
          for (var j = 2; j < fields.length; j++) { if (j !== i) { rest.push(get(j)); } }
          dateRaw = get(i);
          timeRaw = rest[0] || '';
          place = rest[1] || '';
          note = rest.slice(2).join(' ').trim();
          break;
        }
      }
    }
    var start = '', end = '';
    var tm = /(\d{1,2}[:：]\d{2})\s*[-–~至到]\s*(\d{1,2}[:：]\d{2})/.exec(timeRaw || '');
    if (tm) { start = tm[1].replace('：', ':'); end = tm[2].replace('：', ':'); }
    else {
      var t1 = /(\d{1,2}[:：]\d{2})/.exec(timeRaw || '');
      if (t1) { start = t1[1].replace('：', ':'); }
    }
    return {
      typeRaw: typeKey, type: typeKey, title: title || '未命名事件',
      dateRaw: dateRaw, date: parseDateLoose(dateRaw, new Date().getFullYear()),
      start: start, end: end, place: place, note: note, issues: []
    };
  }

  /** 没给颜色时按课程名分配（同名同色，且每次导入都稳定） */
  function nameColorKey(name) {
    var s = String(name || '');
    var h = 7;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) % 100003; }
    var pal = (AR.Util && AR.Util.PALETTE) || [];
    if (!pal.length) { return 'blue'; }
    return pal[h % pal.length].key;
  }

  /* 颜色（第 8 个字段，或写成「颜色=蓝」）：先认中文色名，再认 #RRGGBB */
  var COLOR_WORDS = {
    '红': 'red', '红色': 'red', '砖红': 'red', 'red': 'red',
    '橙': 'orange', '橙色': 'orange', '暖橙': 'orange', 'orange': 'orange',
    '黄': 'amber', '黄色': 'amber', '琥珀': 'amber', '琥珀色': 'amber', '金': 'amber', 'yellow': 'amber', 'amber': 'amber',
    '绿': 'green', '绿色': 'green', '苔绿': 'green', 'green': 'green',
    '青': 'teal', '青色': 'teal', '青碧': 'teal', 'teal': 'teal', 'cyan': 'teal',
    '蓝': 'blue', '蓝色': 'blue', '雾蓝': 'blue', 'blue': 'blue',
    '紫': 'purple', '紫色': 'purple', '紫藤': 'purple', 'purple': 'purple',
    '粉': 'pink', '粉色': 'pink', '藕粉': 'pink', 'pink': 'pink',
    '靛': 'indigo', '靛蓝': 'indigo', 'indigo': 'indigo',
    '竹青': 'lime', '草绿': 'lime', 'lime': 'lime',
    '棕': 'brown', '棕色': 'brown', '栗棕': 'brown', 'brown': 'brown',
    '灰': 'slate', '灰色': 'slate', '石墨': 'slate', 'slate': 'slate', 'gray': 'slate', 'grey': 'slate'
  };

  /** 把「蓝」「蓝色」「#5B8DEF」「颜色=蓝」这类都解析成颜色键；认不出返回 null */
  function parseColorToken(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) { return null; }
    var m = /^颜色\s*[:：=]?\s*(.*)$/.exec(t);
    if (m && m[1]) { t = m[1].trim(); }
    var hex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(t);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
      return '#' + h.toUpperCase();
    }
    if (COLOR_WORDS[t]) { return COLOR_WORDS[t]; }
    var low = t.toLowerCase();
    if (COLOR_WORDS[low]) { return COLOR_WORDS[low]; }
    return null;
  }

  function looksLikeArTxt(text) {
    var t = String(text || '');
    if (/AbbeyRoad\s*课表/i.test(t)) { return true; }
    var lines = t.split('\n');
    for (var i = 0; i < Math.min(lines.length, 60); i++) {
      var l = lines[i].trim();
      if (!l) { continue; }
      if (AR_SEP_RE.test(l) && l.split(AR_SEP_RE).length >= 3) { return true; }
      if (/^(调课|停课|补课|换教室|换时间|加课|变动)\s*[｜|]/.test(l)) { return true; }
    }
    return false;
  }

  function looksLikeNote(t) {
    return /(需|带|考|作业|实验|上机|注意|备|预习|复习|教材|白板|直播|录播|调休|放假|补)/.test(t) && t.length >= 2;
  }

  function isTeacherLike(t) {
    if (RE_TEACHER_HINT.test(t)) { return true; }
    if (/^[\u4e00-\u9fa5·]{2,4}(?:[;；、,\/][\u4e00-\u9fa5·]{2,4})*$/.test(t)) { return true; }
    if (/^[A-Za-z][A-Za-z.\s]{2,24}$/.test(t)) { return true; }
    return false;
  }

  /**
   * 固定顺序的字段列表 → 课程行字段。
   * AR-TXT 的顺序是约定的（课程名｜星期｜节次｜周次｜地点｜老师｜备注），
   * 所以先按位置取；只有当某个位置的内容明显不对（比如星期位置写了别的东西）
   * 才退回内容识别，并把该字段挪到合适的位置。
   */
  function mapArFields(f) {
    var get = function (i) { return String(f[i] == null ? '' : f[i]).trim(); };
    var r = {
      courseName: get(0), teachersRaw: '', place: '',
      weekdayRaw: '', periodsRaw: '', weeksRaw: '', parityRaw: '', note: '', color: null
    };
    var extras = [];

    // ① 位置优先
    var v1 = get(1);
    if (v1 && !isEmpty(v1)) {
      if (parseWeekday(v1)) { r.weekdayRaw = v1; } else { extras.push(v1); }
    }
    var v2 = get(2);
    if (v2 && !isEmpty(v2)) {
      if (isPeriodish(v2)) { r.periodsRaw = v2; } else { extras.push(v2); }
    }
    var v3 = get(3);
    if (v3 && !isEmpty(v3)) {
      if (RE_PARITY_ONLY.test(v3) || RE_NUM_LIST.test(v3) || /周/.test(v3)) { r.weeksRaw = v3; } else { extras.push(v3); }
    }
    var v4 = get(4);
    if (v4 && !isEmpty(v4)) { r.place = v4; }
    var v5 = get(5);
    if (v5 && !isEmpty(v5)) {
      // 老师位置写了备注（「需带教材」这类）也能认出来
      if (looksLikeNote(v5) && !RE_TEACHER_HINT.test(v5)) { r.note = v5; } else { r.teachersRaw = v5; }
    }
    var v6 = get(6);
    if (v6 && !isEmpty(v6)) { r.note = r.note ? (r.note + ' ' + v6) : v6; }
    var v7 = get(7);
    if (v7 && !isEmpty(v7)) {
      var c7 = parseColorToken(v7);
      if (c7) { r.color = c7; } else { extras.push(v7); }
    }
    for (var i = 8; i < f.length; i++) {
      var vx = get(i);
      if (vx && !isEmpty(vx)) { extras.push(vx); }
    }

    // 常见情况：省略了「周次」或「节次」，后面的字段整体前移，
    // 于是老师名字被当成地点。此时如果 extras 里还有像地点的字段，就换回来。
    if (r.place && !r.teachersRaw && !isPlaceLike(r.place) && isTeacherLike(r.place)) {
      for (var q = 0; q < extras.length; q++) {
        if (isPlaceLike(extras[q])) {
          r.teachersRaw = r.place;
          r.place = '';
          break;
        }
      }
    }

    // ② 多余/错位的字段再按内容归位
    for (var j = 0; j < extras.length; j++) {
      var t = extras[j];
      if (!r.weekdayRaw && parseWeekday(t) && t.length <= 8) { r.weekdayRaw = t; continue; }
      if (!r.periodsRaw && isPeriodish(t)) { r.periodsRaw = t; continue; }
      if (!r.weeksRaw && (RE_PARITY_ONLY.test(t) || isWeeksish(t))) { r.weeksRaw = t; continue; }
      if (!r.color && parseColorToken(t)) { r.color = parseColorToken(t); continue; }
      if (!r.place && isPlaceLike(t)) { r.place = t; continue; }
      if (!r.note && looksLikeNote(t)) { r.note = t; continue; }
      if (!r.teachersRaw && isTeacherLike(t)) { r.teachersRaw = t; continue; }
      if (!r.place) { r.place = t; continue; }
      if (!r.teachersRaw && !/[0-9]/.test(t) && t.length <= 16) { r.teachersRaw = t; continue; }
      r.note = r.note ? (r.note + ' ' + t) : t;
    }
    return r;
  }

  /** 解析 AR-TXT 文本，返回 { meta, rows, overrides } */
  function parseArTxt(text, opts) {
    opts = opts || {};
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = { meta: {}, rows: [], overrides: [], events: [] };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { continue; }
      if (/^AbbeyRoad\s*课表/i.test(line)) { continue; }
      if (/^[#/]{1,2}/.test(line) && !AR_SEP_RE.test(line)) { continue; }

      var mStart = /^开学(?:日期|时间)\s*[:：]\s*(.+)$/.exec(line);
      if (mStart) {
        out.meta.startDate = parseDateLoose(mStart[1], new Date().getFullYear());
        continue;
      }
      var mWeeks = /^总周数\s*[:：]\s*(\d{1,2})/.exec(line);
      if (mWeeks) { out.meta.weekCount = Number(mWeeks[1]); continue; }
      var mSem = /^学期\s*[:：]\s*(.+)$/.exec(line);
      if (mSem) { out.meta.name = mSem[1].trim(); continue; }
      var mName = /^课程名\s*[:：]\s*(.+)$/.exec(line);
      if (mName) { continue; }

      var fields = [];
      var parts = line.split(AR_SEP_RE);
      for (var p = 0; p < parts.length; p++) { fields.push(String(parts[p] || '').trim()); }
      // 兼容 Markdown 风格的「| a | b |」写法：去掉首尾空字段
      while (fields.length && !fields[0]) { fields.shift(); }
      while (fields.length && !fields[fields.length - 1]) { fields.pop(); }

      // 表头行与分隔行
      if (fields.length && /^(课程名|课程|课名|名称|星期|周次)$/.test(fields[0])) { continue; }
      if (fields.length && fields.join('').replace(/[-:—–＝=\s]/g, '') === '') { continue; }

      if (fields.length < 2) {
        // 没有分隔符的单行：先看是不是「调课/停课」这类变动行
        var ovs = parseLooseOverrides(line);
        if (ovs.length) { out.overrides.push(ovs[0]); continue; }
        var lf = parseLooseLine(line, true);
        if (lf) { out.rows.push(lf); }
        continue;
      }

      var head = fields[0];
      // 事件行：考试/讲座/活动 ｜ 标题 ｜ 日期 ｜ 时间 ｜ 地点 ｜ 备注
      var evType = EVENT_WORDS[head];
      if (evType) {
        out.events = out.events || [];
        out.events.push(parseEventFields(evType, fields));
        continue;
      }
      var typeKey = AR_TYPE_WORDS[head];
      if (typeKey) {
        out.overrides.push({
          typeRaw: head, courseName: fields[1] || '', dateRaw: fields[2] || '',
          weekdayRaw: fields[3] || '', periodsRaw: fields[4] || '', place: fields[5] || '',
          reason: fields[6] || '',
          date: null, type: null, weekday: null, periodSegments: null, issues: []
        });
        continue;
      }
      out.rows.push(mapArFields(fields));
    }
    return out;
  }

  /** 整篇扫描：跳过区块标题、表格分隔行、以及学期/节次表里的行 */
  function parseLooseText(text) {
    var lines = String(text || '').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { continue; }
      if (/^#{1,6}\s/.test(line)) { continue; }
      if (/^\s*<!--/.test(line)) { continue; }
      if (line.replace(/[|\s:-]/g, '') === '') { continue; }
      if (/(节次|开始时间|结束时间|学期名称|开始日期|总周数)/.test(line)) { continue; }
      if (/^\s*[|]?\s*(课程名|课程|星期|周次|地点|老师)\s*[|]/.test(line)) { continue; }  // 表头行
      // 变动行（含日期 + 调课/停课…）交给变动解析器，不要当成课程
      if (/\d{1,4}\s*[-/.]\s*\d{1,2}/.test(line) && /(调课|停课|补课|换教室|换时间|加课|取消|放假)/.test(line)) { continue; }
      var f = parseLooseLine(line, true);
      if (f) { out.push({ fields: f, lineNo: out.length }); }
    }
    return out;
  }

  /** AI 直接给 JSON 数组时（很常见）也能吃下来 */
  function tryJsonRows(text) {
    var t = String(text || '').trim();
    if (t.charAt(0) !== '[' && t.charAt(0) !== '{') { return null; }
    var data;
    try { data = JSON.parse(t); } catch (e) { return null; }
    var arr = null;
    if (Object.prototype.toString.call(data) === '[object Array]') { arr = data; }
    else if (data && Object.prototype.toString.call(data.courses) === '[object Array]') { arr = data.courses; }
    else if (data && Object.prototype.toString.call(data.rows) === '[object Array]') { arr = data.rows; }
    else if (data && Object.prototype.toString.call(data.data) === '[object Array]') { arr = data.data; }
    if (!arr || !arr.length || typeof arr[0] !== 'object') { return null; }

    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      var f = { courseName: '', teachersRaw: '', place: '', weekdayRaw: '', periodsRaw: '', weeksRaw: '', parityRaw: '', note: '' };
      for (var key in o) {
        if (!Object.prototype.hasOwnProperty.call(o, key)) { continue; }
        var v = o[key];
        if (v == null) { continue; }
        if (Object.prototype.toString.call(v) === '[object Array]') { v = v.join(';'); }
        v = String(v).trim();
        if (!v) { continue; }
        var k = String(key).toLowerCase();
        var target = jsonField(k);
        if (!target) { continue; }
        if (target === 'weekday') {
          if (!f.weekdayRaw) { f.weekdayRaw = v; }
        } else if (target === 'courseName') {
          if (!f.courseName) { f.courseName = v; }
        } else if (!f[target]) {
          f[target] = v;
        }
      }
      // 兜底：字段名完全看不懂时，用值本身猜
      if (!f.courseName && !f.weekdayRaw) {
        var vals = [];
        for (var k2 in o) {
          if (Object.prototype.hasOwnProperty.call(o, k2) && o[k2] != null) { vals.push(String(o[k2])); }
        }
        var guessed = classifyTokens(splitEmbedded(vals.join(' | ')));
        f = guessed;
      }
      out.push(f);
    }
    return out;
  }

  function jsonField(k) {
    var map = {
      courseName: ['课程名', '课程', '课名', '科目', '名称', 'course', 'coursename', 'name', 'subject', 'title'],
      weekday: ['星期', '周几', '星期几', 'weekday', 'day', 'week'],
      periods: ['节次', '节', '时段', 'period', 'periods', 'section', 'sections', '时间', 'time'],
      weeks: ['周次', '周数', '周', 'weeks', 'weeklist', 'week_range', 'weekrange', '周次范围'],
      parity: ['单双周', '周类型', '奇偶', 'parity', 'oddeven'],
      place: ['地点', '教室', '上课地点', '场地', 'location', 'room', 'place', 'classroom'],
      teachersRaw: ['老师', '教师', '授课教师', '任课教师', 'teacher', 'teachers', 'instructor'],
      note: ['备注', '说明', 'note', 'remark', 'comment', 'memo']
    };
    for (var f in map) {
      if (!Object.prototype.hasOwnProperty.call(map, f)) { continue; }
      for (var i = 0; i < map[f].length; i++) {
        if (k === map[f][i] || k.indexOf(map[f][i]) >= 0) { return f; }
      }
    }
    return null;
  }

  function parseOverrideRow(row, cm, lineNo) {
    var it = {
      lineNo: lineNo + 1,
      courseName: cell(row, cm.ovCourse).trim(),
      dateRaw: cell(row, cm.ovDate),
      typeRaw: cell(row, cm.ovType),
      weekdayRaw: cell(row, cm.ovWeekday),
      periodsRaw: cell(row, cm.ovPeriods),
      place: cell(row, cm.ovPlace),
      reason: cell(row, cm.ovReason),
      date: null, type: null, weekday: null, periodSegments: null,
      issues: []
    };
    if (isEmpty(it.courseName) && isEmpty(it.dateRaw)) { return null; }
    finishOverride(it);
    return it;
  }

  /** 变动行的公共校验（表格路径与宽松路径共用） */
  function finishOverride(it) {
    it.date = parseDateLoose(it.dateRaw, new Date().getFullYear());
    if (!it.date) {
      it.issues.push({ code: 'E050', level: 'error', message: '第 ' + it.lineNo + ' 条变动：日期无法识别（“' + it.dateRaw + '”）。' });
    }
    var tv = norm(it.typeRaw);
    for (var k in TYPE_MAP) {
      if (!Object.prototype.hasOwnProperty.call(TYPE_MAP, k)) { continue; }
      if (tv.indexOf(k) >= 0) { it.type = TYPE_MAP[k]; break; }
    }
    if (!it.type) {
      it.issues.push({ code: 'E051', level: 'error', message: '第 ' + it.lineNo + ' 条变动：类型无法识别（“' + it.typeRaw + '”）。' });
    }
    if (it.type && it.type !== 'cancel') {
      it.weekday = parseWeekday(it.weekdayRaw);
      it.periodSegments = parsePeriods(it.periodsRaw);
      if (it.type === 'makeup' || it.type === 'add') {
        if (!it.weekday && it.date) { it.weekday = U.weekdayOf(U.parseDateKey(it.date)); }
      }
    }
    return it;
  }

  /** 宽松：从整篇文字里找「日期 + 调课/停课/补课…」的行 */
  function parseLooseOverrides(text) {
    var lines = String(text || '').split('\n');
    var out = [];
    var RE_DATE = /(\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|\d{1,2}\s*[-/.]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日?)/;
    var RE_TYPE = /(调课|停课|补课|换教室|换时间|加课|取消|放假|补上)/;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || /^#{1,6}\s/.test(line)) { continue; }
      var dm = RE_DATE.exec(line);
      var tm = RE_TYPE.exec(line);
      if (!dm || !tm) { continue; }
      var rest = line.replace(dm[0], ' ').replace(tm[0], ' ');
      var f = classifyTokens(splitEmbedded(splitLoose(rest)));
      var reason = '';
      var rm = /(?:原因|备注)\s*[:：]?\s*(.+)$/.exec(line);
      if (rm) { reason = rm[1].trim(); } else if (f.note) { reason = f.note; }
      var it = {
        lineNo: i + 1,
        courseName: f.courseName || '',
        dateRaw: dm[0],
        typeRaw: tm[0],
        weekdayRaw: f.weekdayRaw || '',
        periodsRaw: f.periodsRaw || '',
        place: f.place || '',
        reason: reason,
        date: null, type: null, weekday: null, periodSegments: null,
        issues: []
      };
      finishOverride(it);
      out.push(it);
    }
    return out;
  }

  /** C200 / C210 / C220 */
  function detectConflicts(rows, weekCount) {
    var out = [];
    var occ = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.weekday || !r.periodSegments || !r.weeks || !r.weeks.weeks.length) { continue; }
      var weeks = r.weeks.weeks;
      var segs = r.periodSegments.segments;
      for (var w = 0; w < weeks.length; w++) {
        for (var s = 0; s < segs.length; s++) {
          for (var p = segs[s][0]; p <= segs[s][1]; p++) {
            var key = weeks[w] + '|' + r.weekday + '|' + p;
            if (!occ[key]) { occ[key] = []; }
            occ[key].push(i);
          }
        }
      }
    }
    var seen = {};
    for (var key2 in occ) {
      if (!Object.prototype.hasOwnProperty.call(occ, key2)) { continue; }
      var list = occ[key2];
      if (list.length < 2) { continue; }
      var a = list[0], b = list[1];
      if (a === b) { continue; }
      var ra = rows[a], rb = rows[b];
      var parts = key2.split('|');
      var sig;
      if (ra.courseName === rb.courseName) {
        sig = 'C220|' + ra.lineNo + '|' + rb.lineNo;
        if (seen[sig]) { continue; }
        seen[sig] = true;
        if (ra.place !== rb.place && !isEmpty(ra.place) && !isEmpty(rb.place)) {
          out.push({
            code: 'C220', level: 'conflict',
            message: '「' + ra.courseName + '」第 ' + parts[0] + ' 周 ' + U.WEEKDAY_NAMES[Number(parts[1])]
              + ' 第 ' + parts[2] + ' 节出现两个地点：' + ra.place + ' / ' + rb.place + '（是换教室还是重复？）',
            rowIndex: b
          });
        }
      } else {
        sig = 'C200|' + a + '|' + b;
        if (seen[sig]) { continue; }
        seen[sig] = true;
        out.push({
          code: 'C200', level: 'conflict',
          message: '第 ' + parts[0] + ' 周 ' + U.WEEKDAY_NAMES[Number(parts[1])] + ' 第 ' + parts[2] + ' 节：'
            + ra.courseName + ' 与 ' + rb.courseName + ' 时间冲突',
          rowIndex: b
        });
      }
    }
    return out;
  }

  /* ── 转成可写入的数据（含连堂课合并） ────────────────────── */

  /**
   * 把解析结果转成实体；只处理「没有 error 的行」。
   * 返回 { semester, periods, teachers, locations, courses, blocks, overrides, mergedCount, suggestions }
   */
  function toEntities(parsed, existingState, options) {
    U = AR.Util;
    options = options || {};
    var nowIso = new Date().toISOString();
    var sem = existingState ? AR.Store.currentSemester() : null;
    var weekCount = (parsed.semester && parsed.semester.weekCount) || (sem ? sem.weekCount : 20);
    var teacherMap = {}, locationMap = {};
    var i, j;
    if (existingState) {
      for (i = 0; i < existingState.teachers.length; i++) { teacherMap[existingState.teachers[i].name] = existingState.teachers[i]; }
      for (i = 0; i < existingState.locations.length; i++) { locationMap[existingState.locations[i].raw] = existingState.locations[i]; }
    }

    var out = {
      semester: null, periods: [], teachers: [], locations: [],
      courses: [], blocks: [], overrides: [], events: [], mergedCount: 0, suggestions: []
    };

    if (parsed.semester && parsed.semester.startDate) {
      out.semester = {
        id: sem ? sem.id : U.uid(),
        name: parsed.semester.name || (sem ? sem.name : '我的学期'),
        startDate: parsed.semester.startDate,
        weekCount: parsed.semester.weekCount || (sem ? sem.weekCount : 20),
        isCurrent: true,
        holidays: sem ? sem.holidays || [] : [],
        updatedAt: nowIso
      };
    }

    for (i = 0; i < parsed.periods.length; i++) {
      var p = parsed.periods[i];
      out.periods.push({
        id: U.uid(), semesterId: out.semester ? out.semester.id : (sem ? sem.id : null),
        index: p.index, label: p.label, start: p.start, end: p.end, updatedAt: nowIso
      });
    }

    var courseMap = {};
    var blocks = [];

    for (i = 0; i < parsed.rows.length; i++) {
      var r = parsed.rows[i];
      if (hasError(r.issues)) { continue; }
      if (!r.weekday || !r.periodSegments || !r.weeks || !r.weeks.weeks.length) { continue; }

      // 老师
      var tNames = String(r.teachersRaw || '').split(/[;；,，、\/]/);
      var tIds = [];
      for (j = 0; j < tNames.length; j++) {
        var tname = tNames[j].trim();
        if (isEmpty(tname)) { continue; }
        if (!teacherMap[tname]) {
          teacherMap[tname] = { id: U.uid(), name: tname, note: '', contact: '', updatedAt: nowIso };
          out.teachers.push(teacherMap[tname]);
        }
        tIds.push(teacherMap[tname].id);
      }

      // 地点
      var locIds = [];
      if (!isEmpty(r.place)) {
        var placeRaw = r.place.trim();
        if (!locationMap[placeRaw]) {
          var parsedPlace = parsePlaceParts(placeRaw, existingState ? existingState.settings.integration : {});
          locationMap[placeRaw] = {
            id: U.uid(), raw: placeRaw, building: parsedPlace.building, campus: parsedPlace.campus,
            university: parsedPlace.university, city: parsedPlace.city, room: parsedPlace.room,
            navQueryOverride: '', updatedAt: nowIso
          };
          out.locations.push(locationMap[placeRaw]);
        }
        locIds.push(locationMap[placeRaw].id);
      }

      // 课程（同名复用）
      var key = r.courseName;
      if (!courseMap[key]) {
        var exist = null;
        if (existingState) {
          for (var ci = 0; ci < existingState.courses.length; ci++) {
            if (existingState.courses[ci].name === r.courseName) { exist = existingState.courses[ci]; break; }
          }
        }
        // 颜色优先级：AI 从原图认出来的颜色 > 已有同名课的颜色 > 按名字自动分配
        var colorKey = r.color || (exist ? exist.colorKey : nameColorKey(r.courseName));
        courseMap[key] = {
          id: exist ? exist.id : U.uid(),
          semesterId: out.semester ? out.semester.id : (sem ? sem.id : null),
          name: r.courseName,
          teacherIds: tIds.slice(),
          defaultLocationId: locIds.length ? locIds[0] : null,
          colorKey: colorKey,
          tags: [], note: r.note && !isEmpty(r.note) ? r.note : '',
          updatedAt: nowIso
        };
        out.courses.push(courseMap[key]);
      } else {
        // 合并老师与地点
        for (j = 0; j < tIds.length; j++) {
          if (courseMap[key].teacherIds.indexOf(tIds[j]) < 0) { courseMap[key].teacherIds.push(tIds[j]); }
        }
        if (!courseMap[key].defaultLocationId && locIds.length) { courseMap[key].defaultLocationId = locIds[0]; }
      }

      // 一个课程行可能含多段（如 1,3）
      for (j = 0; j < r.periodSegments.segments.length; j++) {
        var seg = r.periodSegments.segments[j];
        blocks.push({
          id: U.uid(),
          courseId: courseMap[key].id,
          courseName: r.courseName,
          weekday: r.weekday,
          periodStart: seg[0],
          periodEnd: seg[1],
          weekMode: r.weekMode || 'custom',
          weeks: (r.weeks.weeks || []).slice(),
          locationIds: locIds.slice(),
          teacherIds: tIds.slice(),
          note: r.note && !isEmpty(r.note) ? r.note : '',
          isConsecutive: false,
          segments: null,
          updatedAt: nowIso
        });
      }
    }

    // 连堂课自动合并（规则见规划文档 §6.8）
    var mode = options.mergeMode || 'auto';
    if (mode !== 'never') {
      var res = AR.Schedule.mergeConsecutive(blocks, weekCount);
      out.blocks = res.merged;
      out.suggestions = res.suggestions;
      out.mergedCount = blocks.length - res.merged.length;
    } else {
      out.blocks = blocks;
    }
    for (i = 0; i < out.blocks.length; i++) { delete out.blocks[i].courseName; delete out.blocks[i].mergedIds; }

    // 调课与停课
    for (i = 0; i < parsed.overrides.length; i++) {
      var ov = parsed.overrides[i];
      if (hasError(ov.issues)) { continue; }
      var target = courseMap[ov.courseName];
      if (!target) {
        // 在已有课程里找
        if (existingState) {
          for (j = 0; j < existingState.courses.length; j++) {
            if (existingState.courses[j].name === ov.courseName) { target = existingState.courses[j]; break; }
          }
        }
      }
      if (!target) {
        issuesPushNotFound(parsed, ov);
        continue;
      }
      var ovLocIds = [];
      if (!isEmpty(ov.place)) {
        var praw = ov.place.trim();
        if (!locationMap[praw]) {
          var pp = parsePlaceParts(praw, existingState ? existingState.settings.integration : {});
          locationMap[praw] = {
            id: U.uid(), raw: praw, building: pp.building, campus: pp.campus,
            university: pp.university, city: pp.city, room: pp.room,
            navQueryOverride: '', updatedAt: nowIso
          };
          out.locations.push(locationMap[praw]);
        }
        ovLocIds.push(locationMap[praw].id);
      }
      out.overrides.push({
        id: U.uid(), courseId: target.id, blockId: null,
        date: ov.date, type: ov.type,
        newWeekday: ov.weekday || null,
        newPeriodStart: ov.periodSegments ? ov.periodSegments.start : null,
        newPeriodEnd: ov.periodSegments ? ov.periodSegments.end : null,
        newLocationIds: ovLocIds, newNote: '', reason: ov.reason || '',
        updatedAt: nowIso
      });
    }

    // 特殊事件（考试 / 讲座 / 活动）
    var evs = parsed.events || [];
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (!e.date) { continue; }
      out.events.push({
        id: U.uid(), title: e.title, type: e.type || 'other', date: e.date,
        start: e.start || '', end: e.end || '', place: e.place || '', note: e.note || '',
        updatedAt: nowIso
      });
    }

    return out;
  }

  function issuesPushNotFound(parsed, ov) {
    parsed.issues.push({
      code: 'E040', level: 'warn',
      message: '变动记录里的「' + ov.courseName + '」在课程表中找不到对应课程，已跳过该条（把课程补进「## 课程」表后可重新导入）。'
    });
  }

  function hasError(list) {
    for (var i = 0; i < list.length; i++) { if (list[i].level === 'error') { return true; } }
    return false;
  }

  /** 简单地点结构化：保留原始文本，同时猜出楼栋/校区/教室号 */
  function parsePlaceParts(raw, integration) {
    var s = AR.Location.normalizePlace(raw);
    var room = '';
    var m = /(教室|课室|机房|实验室|报告厅|阶梯教室|智慧教室|多媒体)[^ ]*/g.exec(s);
    if (m) { room = m[0]; }
    else {
      var m2 = /([A-Za-z]?\d{3,4}|[东西南北]?\d-\d{2,3}|[A-Z]-\d{3})\s*$/.exec(s);
      if (m2) { room = m2[1]; }
    }
    var out = {
      room: room,
      building: '',
      campus: (integration && integration.campus) || '',
      city: (integration && integration.city) || '',
      university: (integration && integration.university) || ''
    };
    var bm = /([^\s]{1,12}?(楼|馆|中心|教学楼|实验楼|体育馆|图书馆))/.exec(s);
    if (bm) { out.building = bm[1]; }
    return out;
  }

  /**
   * 合并到当前数据（导入应用时调用）
   */
  function applyEntities(entities, state) {
    var U2 = AR.Util;
    var i;
    if (entities.semester) {
      var found = null;
      for (i = 0; i < state.semesters.length; i++) { if (state.semesters[i].id === entities.semester.id) { found = state.semesters[i]; } }
      if (found) {
        found.name = entities.semester.name;
        found.startDate = entities.semester.startDate;
        found.weekCount = entities.semester.weekCount;
        found.updatedAt = entities.semester.updatedAt;
      } else {
        state.semesters.push(entities.semester);
        state.settings.schedule.currentSemesterId = entities.semester.id;
      }
    }
    if (entities.periods.length) {
      var semId = entities.semester ? entities.semester.id : state.settings.schedule.currentSemesterId;
      // 覆盖同一个学期的节次表
      var kept = [];
      for (i = 0; i < state.periods.length; i++) {
        if (state.periods[i].semesterId !== semId) { kept.push(state.periods[i]); }
      }
      state.periods = kept.concat(entities.periods);
    }
    /**
     * v0.2.2：老师 / 地点 / 课程按名字（地点按原文）复用，
     * 并把「对方的 id → 本地 id」记下来 —— 不然同一份课表导入第二遍时，
     * 课程会被合并、时段却还挂着对方那门课的 id，变成一堆
     * 「界面上看不见、数据里越攒越多」的孤儿时段。
     */
    var simpleTables = ['teachers', 'locations', 'courses'];
    var keyFns = {
      teachers: function (r) { return r.name ? ('n:' + r.name) : null; },
      locations: function (r) { return r.raw ? ('r:' + r.raw) : null; },
      courses: function (r) { return r.name ? ('n:' + r.name + '|' + (r.semesterId || '')) : null; }
    };
    var idMap = { teacher: {}, location: {}, course: {} };
    for (var t = 0; t < simpleTables.length; t++) {
      var name = simpleTables[t];
      var single = name.replace(/s$/, '');
      if (!Array.isArray(state[name])) { state[name] = []; }
      var byKey = {};
      for (i = 0; i < state[name].length; i++) {
        var rec = state[name][i];
        var rk = keyFns[name](rec);
        if (rk && byKey[rk] === undefined) { byKey[rk] = rec; }
      }
      for (i = 0; i < entities[name].length; i++) {
        var incoming = entities[name][i];
        var ik = keyFns[name](incoming);
        var hit = ik ? byKey[ik] : null;
        if (hit) {
          idMap[single][incoming.id] = hit.id;
        } else {
          state[name].push(incoming);
          if (ik) { byKey[ik] = incoming; }
          idMap[single][incoming.id] = incoming.id;
        }
      }
    }

    /** 同一条时段的内容指纹：课程 + 星期 + 节次 + 周次 */
    function blockFingerprint(b) {
      return [b.courseId, b.weekday, b.periodStart, b.periodEnd, b.weekMode || 'all',
        (b.weeks || []).slice().sort(function (x, y) { return x - y; }).join('.')].join('|');
    }

    // 时段：重复导入同一门课时不再加一条，而是把地点 / 老师 / 备注更新过去
    if (!Array.isArray(state.blocks)) { state.blocks = []; }
    var haveBlocks = {};
    for (i = 0; i < state.blocks.length; i++) {
      haveBlocks[blockFingerprint(state.blocks[i])] = state.blocks[i];
    }
    for (i = 0; i < entities.blocks.length; i++) {
      var blk = entities.blocks[i];
      var mapped = {
        id: blk.id,
        courseId: idMap.course[blk.courseId] || blk.courseId,
        weekday: blk.weekday, periodStart: blk.periodStart, periodEnd: blk.periodEnd,
        weekMode: blk.weekMode, weeks: (blk.weeks || []).slice(),
        locationIds: (blk.locationIds || []).map(function (x) { return idMap.location[x] || x; }),
        teacherIds: (blk.teacherIds || []).map(function (x) { return idMap.teacher[x] || x; }),
        note: blk.note || '', isConsecutive: !!blk.isConsecutive, segments: blk.segments || null,
        updatedAt: blk.updatedAt
      };
      var fp = blockFingerprint(mapped);
      var exists = haveBlocks[fp];
      if (exists) {
        if (mapped.locationIds.length) { exists.locationIds = mapped.locationIds; }
        if (mapped.teacherIds.length) { exists.teacherIds = mapped.teacherIds; }
        if (mapped.note) { exists.note = mapped.note; }
        exists.updatedAt = mapped.updatedAt;
        continue;
      }
      haveBlocks[fp] = mapped;
      state.blocks.push(mapped);
    }

    // 变动记录（调课 / 停课 …）：同课程同日期同类型只留一条
    if (!Array.isArray(state.overrides)) { state.overrides = []; }
    var haveOv = {};
    for (i = 0; i < state.overrides.length; i++) {
      var o0 = state.overrides[i];
      haveOv[[o0.courseId, o0.date, o0.type].join('|')] = true;
    }
    for (i = 0; i < entities.overrides.length; i++) {
      var ov = entities.overrides[i];
      var ovCopy = JSON.parse(JSON.stringify(ov));
      ovCopy.courseId = idMap.course[ov.courseId] || ov.courseId;
      var ovKey = [ovCopy.courseId, ovCopy.date, ovCopy.type].join('|');
      if (haveOv[ovKey]) { continue; }
      haveOv[ovKey] = true;
      state.overrides.push(ovCopy);
    }

    // 特殊事件（考试 / 讲座）：同日期同标题同类型只留一条
    if (!Array.isArray(state.events)) { state.events = []; }
    var haveEv = {};
    for (i = 0; i < state.events.length; i++) {
      var e0 = state.events[i];
      haveEv[[e0.date, e0.type || '', e0.title || ''].join('|')] = true;
    }
    for (i = 0; i < entities.events.length; i++) {
      var ev = entities.events[i];
      var evKey = [ev.date, ev.type || '', ev.title || ''].join('|');
      if (haveEv[evKey]) { continue; }
      haveEv[evKey] = true;
      state.events.push(ev);
    }
    /**
     * v0.2.2：课表里有第 13 节甚至更晚的课，但节次表只到第 12 节 ——
     * 这些课会变成「没有时间」，周表左栏也是空的。这里按实际用到的最大节次自动补齐。
     */
    var added = AR.Store.syncPeriodsToUsage();
    // 导入的课挂在别的学期上（比如刚清空过数据）：把当前学期切过去，别让界面空着
    AR.Store.ensureCurrentSemesterHasData(entities.semester ? entities.semester.id : null);
    AR.Store.save(true);
    return { state: state, periodsAdded: added || 0 };
  }

  /* ── 示例文本（界面上「填入示例」用） ────────────────────── */

  var SEP = AR.Const.FMT_SEP;

  function sampleStart() {
    var d = AR.Util.mondayOf(new Date());
    return AR.Util.dateKey(d);
  }

  function sampleDate(offsetDays) {
    var d = AR.Util.addDays(AR.Util.mondayOf(new Date()), offsetDays);
    return AR.Util.dateKey(d);
  }

  /** 自定义文本格式示例（同时也是「填入示例文本」与演示课表的数据源） */
  var SAMPLE = [
    AR.Const.FMT_HEADER,
    '开学日期：' + sampleStart(),
    '总周数：20',
    ['高等数学A', '周一', '1-2', '1-16', 'XX大学 信息楼 305教室', '张三', '需带教材'].join(SEP),
    ['高等数学A', '周一', '3-4', '1-16', 'XX大学 信息楼 305教室', '张三', '连堂'].join(SEP),
    ['大学物理', '周三', '5-6', '双周', 'XX大学 物理楼 实验2-101', '李四;王五', '实验课'].join(SEP),
    ['英语视听说', '周五', '3-4', '单周', 'XX大学 文科楼 401', '?', '需确认老师'].join(SEP),
    ['体育', '周四', '7-8', '1-16', 'XX大学 体育场', '赵老师', '需带运动鞋'].join(SEP),
    ['数据结构', '周二', '1-2', '1-8,10-16', '信息楼305', '陈老师', '需确认地点'].join(SEP),
    ['数据结构', '周二', '3-4', '双周', 'XX大学 机房 302', '陈老师', '实验课'].join(SEP),
    ['调课', '高等数学A', sampleDate(35), '周四', '1-2', 'XX大学 信息楼 201', '国庆假期调休'].join(SEP),
    ['停课', '大学物理', sampleDate(21)].join(SEP),
    ['补课', '体育', sampleDate(42), '周日', '7-8', 'XX大学 体育场', '补第3周课程'].join(SEP)
  ].join('\n');

  /** 空数据时的演示课表（设置 → 数据里有「载入演示课表」） */
  function demoEntities(state) {
    var parsed = parse(SAMPLE, { weekCount: 20 });
    return toEntities(parsed, state || null, { mergeMode: 'auto' });
  }

  AR.MdParse = {
    parse: parse,
    toEntities: toEntities,
    applyEntities: applyEntities,
    stripFences: stripFences,
    parseWeekday: parseWeekday,
    parsePeriods: parsePeriods,
    parseWeeks: parseWeeks,
    parseDateLoose: parseDateLoose,
    detectConflicts: detectConflicts,
    parsePlaceParts: parsePlaceParts,
    sample: SAMPLE,
    demoEntities: demoEntities,
    PARSE_VERSION: 'ar-txt-1.0'
  };
})();

