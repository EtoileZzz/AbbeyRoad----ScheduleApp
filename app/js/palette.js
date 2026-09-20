/* ──────────────────────────────────────────────────────────────
   Abbey Road · 课程配色（AR.Palette）

   课表里课程块是"彩色底 + 白字"，所以配色不能只追求好看：
   每个颜色都要够深，白字才读得清；同一门课在不同周也要一眼认出来。

   这一版提供按「课程类型」分色系的方案：
     理科 = 蓝青系、文科 = 红紫暖系、公共/通识 = 绿系、
     体育 = 橙系、水课 = 低饱和灰蓝（故意"退到后面"）。
   类型可以自动识别（按课程名关键词），也可以在课程编辑器里手动指定。
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  var TRACKS = [
    { key: 'science', label: '理科' },
    { key: 'arts', label: '文科' },
    { key: 'general', label: '公共 / 通识' },
    { key: 'pe', label: '体育' },
    { key: 'water', label: '水课 / 选修' }
  ];

  /** 关键词表：只用来"猜"，猜错了在课程编辑器里改一下即可 */
  var KEYS = {
    science: ['数学', '物理', '化学', '生物', '统计', '概率', '代数', '几何', '微积分', '力学',
      '电磁', '光学', '热学', '电路', '信号', '材料', '结构', 'c语言', 'c++', '程序', '算法',
      '数据结构', '计算机', '数据库', '网络', '操作系统', '编译', '电子', '通信', '自动化',
      '机械', '土木', '建筑', '测绘', '环境', '地理', '地质', '天文', '医学', '解剖', '药理',
      '实验', '工程', 'Python', 'Java', 'MATLAB', '线性', '离散'],
    arts: ['语文', '文学', '写作', '历史', '哲学', '政治学', '法学', '法律', '经济', '金融',
      '管理', '会计', '英语', '日语', '德语', '法语', '俄语', '翻译', '听说', '读写', '艺术',
      '音乐', '美术', '设计', '书法', '新闻', '传播', '社会', '教育', '心理', '文化', '伦理',
      '美学', '戏剧', '影视', '语言学'],
    // 注意：这里不要放"大学"这种过于宽泛的词，否则「大学物理」会被判成公共课
    general: ['思政', '思想道德', '马克思', '毛泽东', '近代史', '形势与政策', '通识', '导论',
      '概论', '军事', '国防', '健康', '生涯', '职业', '创新创业', '劳动', '安全教育'],
    pe: ['体育', '健身', '球', '篮球', '足球', '排球', '乒乓', '羽毛', '网球', '游泳', '田径',
      '太极', '武术', '瑜伽', '健美', '操']
  };

  /** 自动识别课程类型 */
  function inferTrack(name) {
    var s = String(name || '').toLowerCase();
    // 顺序很重要：先体育（"体育"二字很独特），再理科/公共（关键词更具体），最后文科兜底
    var order = ['pe', 'science', 'general', 'arts'];
    for (var i = 0; i < order.length; i++) {
      var list = KEYS[order[i]];
      for (var j = 0; j < list.length; j++) {
        if (s.indexOf(String(list[j]).toLowerCase()) >= 0) { return order[i]; }
      }
    }
    return 'arts';      // 认不出来就归到文科色系（暖色，最不容易和理科蓝撞）
  }

  /**
   * 配色方案：每个方案给 5 个类型各一组颜色（够深，白字可读）。
   * 同一类型里按课程顺序取色，所以同类型的课颜色相近、又好区分。
   */
  var SCHEMES = {
    classic: {
      name: '经典彩色（默认）',
      desc: '沿用原来的 12 色，但按类型分组：理科蓝青、文科红紫、公共绿、体育橙黄、水课石墨。',
      map: {
        science: ['#5B8DEF', '#4A6BE0', '#1FA8A0'],
        arts: ['#E5484D', '#D9649B', '#7C6EE6', '#9A6B4F'],
        general: ['#2FB37A', '#6FA32B'],
        pe: ['#D9A22B', '#E8843C'],
        water: ['#5A6072', '#6B7280', '#7A8194']
      }
    },
    tracks: {
      name: '文理分科',
      desc: '理科蓝青、文科红紫、公共绿、体育橙、水课低饱和灰蓝。',
      map: {
        science: ['#2F6FD0', '#2B7FB8', '#1E8FA6', '#3A63C8', '#26689E'],
        arts: ['#C0504A', '#B04A73', '#9A4FA8', '#C2703C', '#A84A5C'],
        general: ['#2F8F63', '#3E8F45', '#2E8C86', '#4C8B3A'],
        pe: ['#C08A2E', '#B4762B', '#C79A3A'],
        water: ['#6B7A93', '#7A8496', '#5F7286', '#77808F']
      }
    },
    /**
     * 莫兰迪色系：低饱和、带灰调，像蒙了一层灰的颜料。
     * 仍然按文理/公共/体育/水课分族，只是整体更"安静"：
     * 理科=灰蓝、文科=灰玫紫、公共=灰绿、体育=灰驼、水课=纯灰。
     * 这些颜色偏亮，课块文字会自动切成深色（见 ui.js contrastClass），
     * 所以读起来比"白字配浅色"清楚得多。
     */
    morandi: {
      name: '莫兰迪色系',
      desc: '低饱和灰调：理科灰蓝、文科灰玫紫、公共灰绿、体育灰驼、水课纯灰。',
      map: {
        science: ['#7C8FA3', '#6E8199', '#8A9AA8', '#78909C', '#6C7F8F'],
        arts: ['#A98D91', '#9E8794', '#B0938D', '#A38FA0', '#967F86'],
        general: ['#8FA68E', '#9AAE93', '#869C8B', '#A3AE9B'],
        pe: ['#B39B7D', '#A8906F', '#BCA588'],
        water: ['#9A9A96', '#A5A29C', '#8E8E8B', '#A8A6A1']
      }
    },
    warm: {
      name: '暖阳',
      desc: '红橙黄紫为主，冬天看着舒服，适合文科课多的课表。',
      map: {
        science: ['#C2703C', '#B85A2B', '#A84F6B', '#C4553F'],
        arts: ['#C0504A', '#B04A73', '#9A4FA8', '#A93226'],
        general: ['#C08A2E', '#B4762B', '#9E5B3C', '#C79A3A'],
        pe: ['#C08A2E', '#B4762B'],
        water: ['#8A7A70', '#7C7268', '#8E8078']
      }
    },
    contrast: {
      name: '高对比',
      desc: '饱和度更高、彼此差得远，投影/强光下也一眼分得清。',
      map: {
        science: ['#1F6FB2', '#117A65', '#2471A3', '#1B5E9C'],
        arts: ['#C0392B', '#A93226', '#7D3C98', '#B03A5B'],
        general: ['#1E8449', '#117A65', '#2E8B57', '#186A3B'],
        pe: ['#B9770E', '#A04000', '#CA6F1E'],
        water: ['#5D6D7E', '#616A6B', '#707B7C', '#566573']
      }
    }
  };

  function schemeList() {
    var out = [];
    for (var k in SCHEMES) {
      if (Object.prototype.hasOwnProperty.call(SCHEMES, k)) {
        out.push({ key: k, name: SCHEMES[k].name, desc: SCHEMES[k].desc });
      }
    }
    return out;
  }

  /** 取某门课在当前方案下的颜色；返回 null 表示"不参与重排"（经典方案） */
  function colorFor(schemeKey, course, indexInTrack) {
    var sc = SCHEMES[schemeKey];
    if (!sc || sc.fixed || !sc.map) { return null; }
    var track = trackOf(course);
    var list = sc.map[track] || sc.map.arts;
    return list[indexInTrack % list.length];
  }

  /** 课程类型：优先用课程上手动指定的，其次按名字猜 */
  function trackOf(course) {
    var t = course && course.track;
    if (t === 'science' || t === 'arts' || t === 'general' || t === 'pe' || t === 'water') { return t; }
    return inferTrack(course && course.name);
  }

  /**
   * 把方案应用到所有课程：同一类型的课按顺序取色。
   * 返回 { ok, changed, stats }。
   */
  function applyScheme(schemeKey) {
    var sc = SCHEMES[schemeKey];
    if (!sc) { return { ok: false, message: '没有这个配色方案' }; }
    var store = AR.Store;
    var st = store.get();
    var nowIso = new Date().toISOString();
    var stats = {}, changed = 0;
    if (!sc.map) { return { ok: false, message: '这个方案没有配色表' }; }
    var counters = {};
    for (var c = 0; c < st.courses.length; c++) {
      var course = st.courses[c];
      var track = trackOf(course);
      counters[track] = (counters[track] || 0);
      var hex = colorFor(schemeKey, course, counters[track]);
      counters[track]++;
      stats[track] = (stats[track] || 0) + 1;
      if (course.colorKey !== hex) { course.colorKey = hex; course.updatedAt = nowIso; changed++; }
    }
    store.save(true);
    return { ok: true, changed: changed, stats: stats };
  }

  AR.Palette = {
    tracks: TRACKS,
    schemes: SCHEMES,
    schemeList: schemeList,
    inferTrack: inferTrack,
    trackOf: trackOf,
    colorFor: colorFor,
    applyScheme: applyScheme,
    trackLabel: function (key) {
      for (var i = 0; i < TRACKS.length; i++) { if (TRACKS[i].key === key) { return TRACKS[i].label; } }
      return '—';
    }
  };
})();
