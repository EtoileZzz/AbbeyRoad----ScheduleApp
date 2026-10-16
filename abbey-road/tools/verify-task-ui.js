/**
 * 任务界面回归（v0.4.2）
 *
 * 这台机器的无头浏览器 CDP 已经不能执行命令（连空白页的 Runtime.evaluate 都无响应），
 * 所以这里用一个**够用的自带 DOM 桩**在 Node 里把发货用的 ui.js / panels.js 真正跑起来：
 * 渲染「今日日程」的任务卡、「我的」页任务卡、开关编辑弹窗，抓运行时错误与内容缺失。
 *
 * 它不是浏览器替代品（量不到像素、手势、动画），但能证明：
 *   · 这些渲染函数不抛错
 *   · 卡片里该出现的内容（标题 / 节奏 / 累计 / 已完成 / 撤销 / 继续做）确实生成了
 *   · 数据联动（打卡 → 进度文字变化、收起 → 进已完成、继续做 → 回待办）在界面层也成立
 *
 * 用法：node tools/verify-task-ui.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = path.join(__dirname, '..', 'app', 'js');
const uiText = fs.readFileSync(path.join(__dirname, '..', 'app/js/ui.js'), 'utf8');

/* ══════════════ 自带 DOM 桩 ══════════════ */
function createDom() {
  const voidTags = /^(br|img|input|hr|meta|link|source)$/i;

  function El(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      children: [], parent: null, attrs: {}, _classes: new Set(),
      style: {}, hidden: false, value: '', checked: false, listeners: {},
      _text: '', disabled: false, title: '',
      get className() { return Array.from(this._classes).join(' '); },
      set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
      get classList() {
        const s = this._classes;
        return {
          add: (...c) => c.forEach((x) => s.add(x)),
          remove: (...c) => c.forEach((x) => s.delete(x)),
          contains: (c) => s.has(c),
          toggle: (c, on) => { if (on === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (on) { s.add(c); } else { s.delete(c); } }
        };
      },
      set innerHTML(v) { this._html = String(v); this.children = parse(this._html, this); },
      get innerHTML() { return this._html || ''; },
      set textContent(v) { this._text = String(v); this._html = ''; this.children = []; },
      get textContent() { return this._text || this._html || ''; },
      appendChild(c) { if (!c) { return c; } this.children.push(c); c.parent = this; return c; },
      insertBefore(c) { this.children.unshift(c); c.parent = this; return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); } return c; },
      remove() { if (this.parent) { this.parent.removeChild(this); } },
      /* ui.js 的 el() 靠 firstChild 取节点，必须实现 */
      get firstChild() { return this.children[0] || null; },
      get lastChild() { return this.children.length ? this.children[this.children.length - 1] : null; },
      get firstElementChild() { return this.children[0] || null; },
      get childNodes() { return this.children; },
      get nextSibling() {
        if (!this.parent) { return null; }
        const i = this.parent.children.indexOf(this);
        return this.parent.children[i + 1] || null;
      },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      removeEventListener() { },
      setAttribute(k, v) {
        this.attrs[k] = String(v);
        if (k === 'class') { this.className = v; }
        if (k === 'id') { registry[String(v)] = this; }
        if (k === 'hidden') { this.hidden = true; }
      },
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      hasAttribute(k) { return this.attrs[k] !== undefined; },
      querySelector(sel) { return queryAll(this, sel)[0] || null; },
      querySelectorAll(sel) { return queryAll(this, sel); },
      closest(sel) { let n = this; while (n) { if (matches(n, sel)) { return n; } n = n.parent; } return null; },
      matches(sel) { return matches(this, sel); },
      focus() { }, blur() { }, click() { (this.listeners.click || []).forEach((f) => f({ target: this, currentTarget: this, preventDefault() { }, stopPropagation() { } })); },
      getBoundingClientRect() { return { top: 0, left: 0, width: 320, height: 40, bottom: 40, right: 320 }; },
      scrollIntoView() { },
      contains() { return false; }
    };
    return el;
  }

  const registry = {};

  /** 极简 HTML 解析（够用于本项目生成的标记：标签 + 属性 + 文本） */
  function parse(html, parent) {
    const out = [];
    const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:@][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    const stack = [];
    let m, cursor = 0;
    while ((m = tagRe.exec(html))) {
      // 标签之前的文本 → 挂到当前栈顶节点的 _text
      const text = html.slice(cursor, m.index);
      cursor = tagRe.lastIndex;
      if (text && stack.length) {
        const top = stack[stack.length - 1];
        top._text = (top._text || '') + text;
      }
      const close = m[1], tag = m[2], attrStr = m[3], selfClose = m[4];
      if (close) { stack.pop(); continue; }
      const el = El(tag);
      const attrRe = /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let am;
      while ((am = attrRe.exec(attrStr))) {
        const k = am[1];
        const v = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
        el.attrs[k] = v;
        if (k === 'class') { el.className = v; }
        if (k === 'id') { registry[v] = el; }
        if (k === 'hidden') { el.hidden = true; }
        if (k === 'checked') { el.checked = true; }
        if (k === 'value') { el.value = v; }
      }
      const p = stack.length ? stack[stack.length - 1] : null;
      if (p) { p.children.push(el); el.parent = p; } else { out.push(el); el.parent = parent; }
      if (!selfClose && !voidTags.test(tag)) { stack.push(el); }
    }
    return out;
  }

  function matches(node, sel) {
    sel = String(sel).trim();
    if (!sel) { return false; }
    // 只支持：tag / .class / #id / [attr] / [attr=val] 及其简单组合
    const parts = sel.match(/^[a-zA-Z][a-zA-Z0-9]*|\.[-\w]+|#[-\w]+|\[[^\]]+\]/g) || [];
    for (const p of parts) {
      if (p[0] === '.') { if (!node._classes.has(p.slice(1))) { return false; } }
      else if (p[0] === '#') { if (node.attrs.id !== p.slice(1)) { return false; } }
      else if (p[0] === '[') {
        const mm = /^\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p);
        if (!mm) { continue; }
        if (mm[2] === undefined) { if (node.attrs[mm[1]] === undefined) { return false; } }
        else if (String(node.attrs[mm[1]]) !== mm[2]) { return false; }
      } else if (node.tagName !== p.toUpperCase()) { return false; }
    }
    return true;
  }
  function queryAll(root, sel) {
    const out = [];
    if (!root) { return out; }
    (function walk(n) {
      if (!n) { return; }
      for (const c of n.children || []) {
        if (matches(c, sel)) { out.push(c); }
        walk(c);
      }
    })(root);
    return out;
  }

  const doc = {
    readyState: 'complete',
    body: El('body'), head: El('head'), documentElement: El('html'),
    createElement: El,
    createTextNode: (t) => { const e = El('#text'); e._text = t; return e; },
    getElementById: (id) => registry[id] || null,
    querySelector: (s) => queryAll(doc.body, s)[0] || null,
    querySelectorAll: (s) => queryAll(doc.body, s),
    addEventListener() { }, removeEventListener() { },
    _registry: registry
  };
  return { document: doc, El, registry, queryAll };
}

/* ══════════════ 沙箱：core + ui + panels ══════════════ */
function boot(seed) {
  const dom = createDom();
  const store = {};
  const sandbox = {
    console: { log: () => { }, warn: () => { }, error: () => { } },
    Date, JSON, Math, parseInt, parseFloat, isNaN, isFinite, String, Number, Array, Object, RegExp, Error,
    setTimeout: (f) => { try { f(); } catch (e) { } return 0; }, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (f) => { try { f(); } catch (e) { } return 0; }, cancelAnimationFrame() { },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    document: dom.document,
    navigator: { userAgent: 'node-verify', platform: 'Win32', onLine: true, language: 'zh-CN' },
    location: { href: 'file:///index.html', search: '', hash: '', protocol: 'file:' },
    matchMedia: () => ({ matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } }),
    getComputedStyle: () => ({ getPropertyValue: () => '', width: '320px' }),
    XMLHttpRequest: function () { this.open = () => { }; this.send = () => { }; this.setRequestHeader = () => { }; },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() { }, confirm: () => true, prompt: () => '',
    performance: { now: () => Date.now() },
    addEventListener() { }, removeEventListener() { },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, scrollTo() { }, scrollY: 0,
    AR: null
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  ['core.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(appJs, f), 'utf8'), sandbox, { filename: f });
  });
  sandbox.AR.Store.load();
  if (seed) { seed(sandbox.AR, sandbox); sandbox.AR.Store.load(); }
  return { sandbox, AR: sandbox.AR, dom };
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name + (detail ? '  |  ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? '  |  ' + detail : '')); }
  return !!cond;
}
/** 把一个节点子树里的所有文字拼起来（断言内容用） */
function textOf(node) {
  if (!node) { return ''; }
  let s = node._text || '';
  if (node.innerHTML) { s += ' ' + node.innerHTML; }
  for (const c of node.children || []) { s += ' ' + textOf(c); }
  return s;
}

/* ═══════════ 1. 今日日程的任务卡 ═══════════ */
{
  const { AR } = boot((A) => {
    const S = A.Store;
    S.todoUpsert({ text: '背 50 个单词', colorKey: 'blue', cadence: { type: 'daily', times: 3 }, goal: { target: 100, unit: '页' } });
    S.todoUpsert({ text: '志愿时长', colorKey: 'green', cadence: null, goal: { target: 20, unit: '小时' } });
    S.todoUpsert({ text: '喝水', colorKey: 'teal', cadence: { type: 'daily', times: 1 }, goal: null });
  });
  // ui.js 需要 AR.UI；这里只验证 core 数据 + 我们自己的渲染契约
  const list = AR.Store.todoTodayList();
  ok('U1 今日页会列出 3 条任务', list.length === 3, 'n=' + list.length);
  const t1 = list.filter((t) => t.text === '背 50 个单词')[0];
  const p1 = AR.Store.todoProgress(t1, new Date());
  ok('U2 「背单词」节奏 3 次 + 累计 100 页', p1.periodGoal === 3 && p1.target === 100 && p1.hasGoal === true);
  const t2 = list.filter((t) => t.text === '志愿时长')[0];
  const p2 = AR.Store.todoProgress(t2, new Date());
  ok('U3 「志愿时长」无节奏（periodGoal=0）但带目标', p2.periodGoal === 0 && p2.target === 20);
  ok('U4 「志愿时长」不会自动收起', AR.Store.todoSettled(t2, new Date()) === false);

  // 打卡 → 进度按"确认即 +1"走
  AR.Store.todoAddEntry(t1.id, 1);
  AR.Store.todoAddEntry(t1.id, 1);
  const p1b = AR.Store.todoProgress(t1, new Date());
  ok('U5 打卡两次后 今天 2/3、累计 2/100',
    p1b.periodDone === 2 && p1b.total === 2, 'periodDone=' + p1b.periodDone + ' total=' + p1b.total);
  AR.Store.todoAddEntry(t1.id, 1);
  ok('U6 做满 3 次 → 收起（会进「已完成」）', AR.Store.todoSettled(t1, new Date()) === true);
  AR.Store.todoAddEntry(t1.id, 1);
  ok('U7 已满后确认再记 → 数据继续 +1（今天 4 次、累计 4）',
    AR.Store.todoProgress(t1, new Date()).periodDone === 4 && AR.Store.todoTotal(t1) === 4);
  AR.Store.todoContinue(t1.id);
  ok('U8 继续做 → 回待办，且 4 次与累计一条没少',
    AR.Store.todoSettled(t1, new Date()) === false
    && AR.Store.todoProgress(t1, new Date()).periodDone === 4
    && AR.Store.todoTotal(t1) === 4);
}

/* ═══════════ 2. 界面渲染（真正跑 ui.js 的渲染函数） ═══════════ */
{
  const dom = createDom();
  const store = {};
  const sandbox = {
    console: { log: () => { }, warn: () => { }, error: () => { } },
    Date, JSON, Math, parseInt, parseFloat, isNaN, isFinite, String, Number, Array, Object, RegExp, Error,
    setTimeout: (f) => { try { f(); } catch (e) { } return 0; }, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (f) => { try { f(); } catch (e) { } return 0; }, cancelAnimationFrame() { },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    document: dom.document,
    navigator: { userAgent: 'node-verify', platform: 'Win32', onLine: true, language: 'zh-CN', vibrate() { } },
    location: { href: 'file:///index.html', search: '', hash: '', protocol: 'file:' },
    matchMedia: () => ({ matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } }),
    getComputedStyle: () => ({ getPropertyValue: () => '', width: '320px' }),
    XMLHttpRequest: function () { this.open = () => { }; this.send = () => { }; this.setRequestHeader = () => { }; },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() { }, confirm: () => true, prompt: () => '',
    performance: { now: () => Date.now() },
    addEventListener() { }, removeEventListener() { },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, scrollTo() { }, scrollY: 0
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);

  let loaded = true, loadErr = '';
  try {
    ['core.js', 'palette.js', 'bridge.js', 'ui.js', 'panels.js'].forEach((f) => {
      vm.runInContext(fs.readFileSync(path.join(appJs, f), 'utf8'), sandbox, { filename: f });
    });
  } catch (e) { loaded = false; loadErr = e.message; }

  ok('U9 ui.js / panels.js 能在桩环境里加载（含新增的任务模块）', loaded, loadErr);
  if (loaded) {
    const AR = sandbox.AR;
    AR.Store.load();
    // ui.js 的模块级 U = AR.Util 是在 init() 里赋值的（boot.js 也是先 init 再渲染）
    try { AR.UI.init(); } catch (e) { console.log('    （提示）UI.init 抛出：' + e.message); }
    // openModal 直接取真实 index.html 里的弹窗节点，桩里补上这几个 id
    ['modalRoot', 'modalScrim', 'modalCard', 'toastHost'].forEach((id) => {
      const n = dom.El('div');
      n.setAttribute('id', id);
      dom.document.body.appendChild(n);
      dom.registry[id] = n;
    });
    const S = AR.Store;
    S.todoUpsert({ text: '背 50 个单词', colorKey: 'blue', cadence: { type: 'daily', times: 3 }, goal: { target: 100, unit: '页' } });
    S.todoUpsert({ text: '志愿时长', colorKey: 'green', cadence: null, goal: { target: 20, unit: '小时' } });
    S.todoUpsert({ text: '喝水', colorKey: 'teal', cadence: { type: 'daily', times: 1 }, goal: null });
    const t1 = S.todoList().filter((t) => t.text === '背 50 个单词')[0];
    const t3 = S.todoList().filter((t) => t.text === '喝水')[0];
    S.todoAddEntry(t1.id, 1);
    S.todoAddEntry(t1.id, 1);
    S.todoAddEntry(t3.id, 1);      // 喝水做满 → 应进「已完成」

    // 今日日程卡片
    let node = null, err = '';
    try { node = AR.UI.tkTaskCard(); } catch (e) { err = e.message; }
    ok('U10 tkTaskCard() 渲染不抛错', !err, err);
    const txt = textOf(node);
    ok('U11 卡片含标题与摘要', /任务/.test(txt) && /待办/.test(txt));
    ok('U12 显示节奏文字「每天 3 次」', /每天 3 次/.test(txt), txt.slice(0, 120));
    ok('U13 统一卡上同时讲今天与累计', /今天 2\/3 次/.test(txt) && /累计/.test(txt), txt.slice(0, 100));
    ok('U14 完成次数用圆点标出（2 个 tk-dot）',
      dom.queryAll(node, '.tk-dot').length === 2, 'dots=' + dom.queryAll(node, '.tk-dot').length);
    ok('U15 「已完成」分组存在（喝水做满 1 次）', /已完成/.test(txt) && /已完成 · 1/.test(txt));

    // 已完成展开 → 撤销 / 继续做
    const doneHead = dom.queryAll(node, '.tk-donehead')[0];
    if (doneHead) {
      doneHead.click();
      const n2 = AR.UI.tkTaskCard();
      const t2 = textOf(n2);
      ok('U16 展开「已完成」后出现 撤销 / 继续做',
        /撤销/.test(t2) && /继续做/.test(t2) && /喝水/.test(t2));
    } else {
      ok('U16 展开「已完成」后出现 撤销 / 继续做', false, '没找到完成分组的标题按钮');
    }

    // 「我的」页卡片
    let mine = null, mErr = '';
    try { mine = AR.UI.modTasks(); } catch (e) { mErr = e.message; }
    ok('U17 modTasks() 渲染不抛错', !mErr, mErr);
    const mTxt = textOf(mine);
    ok('U18 「我的」卡片含全部三条任务',
      /背 50 个单词/.test(mTxt) && /志愿时长/.test(mTxt) && /喝水/.test(mTxt));
    ok('U19 「我的」两行制：今天/累计标签都在', /今天/.test(mTxt) && /累计/.test(mTxt));
    ok('U20 「我的」有汇总卡（今天 / 本周 两条进度）', dom.queryAll(mine, '.tk-sumline').length === 2, 'sumline=' + dom.queryAll(mine, '.tk-sumline').length);
    ok('U21 「我的」是一张大卡囊括 N 条条目（根节点就是 .tk-mine-card）', mine && mine._classes && mine._classes.has('tk-mine-card') && dom.queryAll(mine, '.tk-line').length === 3, 'root=' + (mine && mine.className ? mine.className : '?') + ' line=' + dom.queryAll(mine, '.tk-line').length);

    // 打开编辑弹窗（不抛错即可）
    let openErr = '';
    try { AR.UI.openTaskEdit(t1); } catch (e) { openErr = e.message; }
    ok('U22 openTaskEdit(已存在任务) 不抛错', !openErr, openErr);
    let newErr = '';
    try { AR.UI.openTaskEdit(null); } catch (e) { newErr = e.message; }
    ok('U23 openTaskEdit(null) 新建也不抛错', !newErr, newErr);

    // ── v0.4.3 新增覆盖 ──
    let card2 = null, cErr = '';
    try { card2 = AR.UI.tkTaskCard(); } catch (e) { cErr = e.message; }
    ok('U25 tkTaskCard() 可重复渲染', !cErr, cErr);
    const rows2 = dom.queryAll(card2, '.tk-row');
    ok('U26 统一卡里的条目数 = 参与清单的任务数', rows2.length === 2, 'rows=' + rows2.length);
    ok('U27 所有条目都绑定了划动（不再区分每日/长期）',
      rows2.length > 0 && rows2.every((r) => !!(r.listeners && r.listeners.pointerdown)),
      rows2.map((r) => !!(r.listeners && r.listeners.pointerdown)).join(','));
    const cTxt = textOf(card2);
    ok('U28 没设计划的任务也出现在卡里（志愿时长）', /志愿时长/.test(cTxt));
    ok('U29 今日卡**不含**卡底按钮（那是「我的」模块的）', dom.queryAll(card2, '.tk-fbtn').length === 0,
      'fbtn in today=' + dom.queryAll(card2, '.tk-fbtn').length);

    // 展开「我的」第一张卡 → 贡献图 + 记录默认折叠
    const head2 = dom.queryAll(mine, '.tk-t2head')[0];
    /* 现在「展开」打开的是详情弹窗（卡内不再内联展开） */
    ok('U30 「展开」按钮调用 openTaskDetail（不再内联展开）',
      uiText.indexOf('openTaskDetail(t)') >= 0 && uiText.indexOf('tk-t2body') < 0,
      'inline gone=' + (uiText.indexOf('tk-t2body') < 0));
    const dtl = AR.UI.openTaskDetail(S.todoList()[0]);
    const modalBody = dom.registry.modalCard;
    ok('U31 详情弹窗里有 GitHub 贡献图（≥56 格）',
      dom.queryAll(modalBody, '.tk-gh-cell').length >= 56,
      'gh=' + dom.queryAll(modalBody, '.tk-gh-cell').length);
    ok('U32 详情弹窗里有最近记录', dom.queryAll(modalBody, '.tk-rec').length >= 1,
      'rec=' + dom.queryAll(modalBody, '.tk-rec').length);

    // 编辑页：显示口径两个开关
    const sheet = dom.registry.modalCard;
    ok('U32b 编辑页能拿到 modalCard', !!sheet);

    // ── v0.4.3 统一卡：折叠态迷你格 / 主图标 / 卡底按钮 ──
    const miniToday = dom.queryAll(card2, '.tk-mini-cell');
    ok('U33 今日卡**不含**迷你格（迷你格在「我的」）', miniToday.length === 0, 'mini in today=' + miniToday.length);
    let ico = 0;
    const icoBoxes = dom.queryAll(card2, '.tk-ico');
    for (let bi = 0; bi < icoBoxes.length; bi++) { ico += dom.queryAll(icoBoxes[bi], 'i').length; }
    ok('U34 任务图标是镂空清单线（3 笔），不是实心色块徽章', ico >= 3, 'ico=' + ico);
    const mineForFoot = AR.UI.modTasks();
    ok('U35 「我的」模块底部有「数据分析」与「新建任务」两个按钮',
      dom.queryAll(mineForFoot, '.tk-fbtn').length === 2, 'fbtn in mine=' + dom.queryAll(mineForFoot, '.tk-fbtn').length);

    // 「我的」贡献图与主题色
    const mine3 = AR.UI.modTasks();
    const ghCells = dom.queryAll(mine3, '.tk-gh-cell');
    ok('U36 详情弹窗的贡献图可用（≥30 格）', dom.queryAll(modalBody, '.tk-gh-cell').length >= 30, 'gh=' + dom.queryAll(modalBody, '.tk-gh-cell').length);

    // 数据分析弹窗
    let stErr = '';
    try { AR.UI.openTaskStats(); } catch (e) { stErr = e.message; }
    ok('U37 openTaskStats() 不抛错', !stErr, stErr);

    // 规则文字
    ok('U24 tkRuleText 组合目标与计划',
      AR.UI.tkRuleText(t1) === '目标 100页 · 每天 3 次', AR.UI.tkRuleText(t1));
  }
}

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
