/**
 * 任务模型回归（v0.4.2：每日任务 + 长期任务合并）
 *
 * 直接加载**发货用的同一份** app/js/core.js（不加载 UI），在最小宿主里跑断言。
 * 覆盖：节奏规则 / 当期目标 / 累计 / 收起与「继续做」/ 打卡即 +1 /
 *       撤销 / 老长期任务无损迁移 / 迁移幂等。
 *
 * 用法：node tools/verify-tasks.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = path.join(__dirname, '..', 'app', 'js');
let store = {};

function freshHost(seed) {
  store = {};
  const sandbox = {
    console: console, Date: Date, JSON: JSON, Math: Math,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['core.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(appJs, f), 'utf8'), sandbox, { filename: f });
  });
  const AR = sandbox.AR;
  /**
   * 顺序很重要：core 的 state 是惰性加载的。
   *   seed 前必须先 load()（拿到 state），seed 写完老数据 save()，再 load() 一次
   *   —— 第二次 load 会走 migrate()，迁移就在那一步发生。
   */
  AR.Store.load();
  if (seed) {
    seed(AR);
    AR.Store.load();
  }
  return AR;
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name + (detail ? '  |  ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? '  |  ' + detail : '')); }
  return !!cond;
}
const j = (o) => JSON.stringify(o);

/* ═══════════ 1. 节奏规则 ═══════════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const d = new Date();
  const t = S.todoUpsert({ text: 'T', cadence: { type: 'daily', times: 3 }, goal: null });

  ok('T1 每天 3 次 → 今天要求 3 次', S.todoRequired(t, d) === 3, 'req=' + S.todoRequired(t, d));
  ok('T2 当期目标 = 3', S.todoPeriodGoal(t) === 3, 'goal=' + S.todoPeriodGoal(t));

  const w = S.todoUpsert({ text: 'W', cadence: { type: 'weekly', times: 3 }, goal: null });
  ok('T3 每周 3 次 → 当期目标 3、单位=本周',
    S.todoPeriodGoal(w) === 3 && S.todoProgress(w, d).periodUnit === '本周');

  const wd = S.todoUpsert({ text: 'WD', cadence: { type: 'weekdays', times: 2, weekdays: [1, 3, 5] }, goal: null });
  ok('T4 周一三五各 2 次 → 当期目标 6', S.todoPeriodGoal(wd) === 6, 'goal=' + S.todoPeriodGoal(wd));

  const en = S.todoUpsert({ text: 'EN', cadence: { type: 'everyN', times: 1, intervalDays: 2 }, goal: null });
  ok('T5 每 2 天 1 次 → 今天要求 1（锚定今天）', S.todoRequired(en, d) === 1);

  const un = S.todoUpsert({ text: 'U', cadence: null, goal: null });
  ok('T6 不填节奏 → 不限次（Infinity）且无当期目标',
    S.todoRequired(un, d) === Infinity && S.todoPeriodGoal(un) === 0,
    'req=' + S.todoRequired(un, d) + ' goal=' + S.todoPeriodGoal(un));
  ok('T7 不限次的任务永不自动收起', S.todoSettled(un, d) === false);
}

/* ═══════════ 2. 打卡与累计（确认即 +1） ═══════════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const t = S.todoUpsert({ text: '背单词', cadence: { type: 'daily', times: 3 }, goal: { target: 100, unit: '页' } });

  S.todoAddEntry(t.id, 1);
  S.todoAddEntry(t.id, 1);
  ok('T8 打卡两次 → 今天 2 次、累计 2',
    S.todoDayCount(t, AR.Util.dateKey(new Date())) === 2 && S.todoTotal(t) === 2,
    'today=' + S.todoDayCount(t, AR.Util.dateKey(new Date())) + ' total=' + S.todoTotal(t));
  ok('T9 2 < 目标 3 → 未收起', S.todoSettled(t, new Date()) === false);

  S.todoAddEntry(t.id, 1);
  ok('T10 做满 3 次 → 收起（进已完成）', S.todoSettled(t, new Date()) === true);

  // 已满之后再打卡：确认即 +1，数据继续增长（产品规则）
  S.todoAddEntry(t.id, 1);
  ok('T11 已满后再打卡仍 +1（计数 4、累计 4）',
    S.todoDayCount(t, AR.Util.dateKey(new Date())) === 4 && S.todoTotal(t) === 4,
    'today=' + S.todoDayCount(t, AR.Util.dateKey(new Date())) + ' total=' + S.todoTotal(t));
}

/* ═══════════ 3. 「继续做」不清数据 ═══════════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const t = S.todoUpsert({ text: '喝水', cadence: { type: 'daily', times: 1 }, goal: null });
  S.todoAddEntry(t.id, 1);
  const before = { today: S.todoDayCount(t, AR.Util.dateKey(new Date())), total: S.todoTotal(t), ents: S.todoById(t.id).entries.length };
  ok('T12 做满 1 次 → 已收起', S.todoSettled(t, new Date()) === true);

  S.todoContinue(t.id);
  ok('T13 继续做 → 回到待办', S.todoSettled(t, new Date()) === false);
  const after = { today: S.todoDayCount(t, AR.Util.dateKey(new Date())), total: S.todoTotal(t), ents: S.todoById(t.id).entries.length };
  ok('T14 继续做不动任何数据（计数/累计/条目数全同）',
    before.today === after.today && before.total === after.total && before.ents === after.ents,
    'before=' + j(before) + ' after=' + j(after));

  S.todoAddEntry(t.id, 1);   // 继续做之后还能继续加
  ok('T15 继续做之后仍可继续打卡（今天变 2 次）',
    S.todoDayCount(t, AR.Util.dateKey(new Date())) === 2);
}

/* ═══════════ 4. 周期切换：aside 失效 ═══════════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const t = S.todoUpsert({ text: '跑步', cadence: { type: 'weekly', times: 1 }, goal: null });
  S.todoAddEntry(t.id, 1);
  S.todoContinue(t.id);
  ok('T16 本周继续做 → 本周不收起', S.todoSettled(t, new Date()) === false);
  // 换到"下周一"这个日期：周期标识不同 → aside 失效 → 重新按节奏判定
  const nextMon = AR.Util.addDays(AR.Util.mondayOf(new Date()), 7);
  ok('T17 跨到下周后，上周的"继续做"不再压制收起逻辑',
    S.todoPeriodKey(t, new Date()) !== S.todoPeriodKey(t, nextMon),
    S.todoPeriodKey(t, new Date()) + ' vs ' + S.todoPeriodKey(t, nextMon));
}

/* ═══════════ 5. 撤销 ═══════════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const t = S.todoUpsert({ text: '实验记录', cadence: { type: 'daily', times: 2 }, goal: null });
  S.todoAddEntry(t.id, 1);
  S.todoAddEntry(t.id, 1);
  ok('T18 两次打卡后已收起', S.todoSettled(t, new Date()) === true);
  S.todoUndoLast(t.id);
  ok('T19 撤销一次 → 回到 1 次且不再收起',
    S.todoDayCount(t, AR.Util.dateKey(new Date())) === 1 && S.todoSettled(t, new Date()) === false);
  const id = S.todoById(t.id).entries.filter((e) => !e.deletedAt)[0].id;
  S.todoRemoveEntry(t.id, id);
  ok('T20 撤销到 0 次，累计也归零（软删除不入累计）',
    S.todoDayCount(t, AR.Util.dateKey(new Date())) === 0 && S.todoTotal(t) === 0);
}

/* ═══════════ 6. 老长期任务无损迁移 ═══════════ */
{
  const seed = (AR) => {
    const S = AR.Store;
    const st = S.get();
    st.longTasks = [
      { id: 'ltA', name: '志愿时长', unit: '小时', target: 20, colorKey: '#34D399',
        showInToday: true, entries: [
          { id: 'e1', amount: 2, at: '2026-10-10T10:00:00.000Z' },
          { id: 'e2', amount: 1.5, at: '2026-10-13T10:00:00.000Z' }
        ] },
      { id: 'ltB', name: '阅读量', unit: '页', target: 100, colorKey: '#5B8DEF',
        showInToday: false, entries: [{ id: 'e3', amount: 30, at: '2026-10-12T10:00:00.000Z' }] }
    ];
    st.tasks2 = [];
    if (!st.meta) { st.meta = {}; }
    delete st.meta.tasksMergedAt;
    S.save(true);
    // 重新加载 → 走 migrate()
    S.load();
  };
  const AR = freshHost(seed);
  const S = AR.Store;
  const list = S.todoList();
  ok('M1 两条长期任务都并进任务表', list.length === 2, 'n=' + list.length);

  const a = list.filter((t) => t.id === 'ltA')[0];
  ok('M2 名称/单位/目标完整搬过来',
    a && a.text === '志愿时长' && a.goal && a.goal.target === 20 && a.goal.unit === '小时',
    a ? j({ text: a.text, goal: a.goal }) : '缺失');
  ok('M3 累计量一分不差（2 + 1.5 = 3.5）', a && S.todoTotal(a) === 3.5, a ? 'total=' + S.todoTotal(a) : '');
  ok('M4 老条目补上了日期键 k', a && a.entries.every((e) => !!e.k), a ? j(a.entries.map((e) => e.k)) : '');
  ok('M5 默认不限次（老长期任务没有节奏）',
    a && S.todoRequired(a, new Date()) === Infinity && S.todoPeriodGoal(a) === 0);

  const b = list.filter((t) => t.id === 'ltB')[0];
  ok('M6 showInToday=false 被保留（不在今日页出现）',
    b && b.showInToday === false && S.todoTodayList().length === 1,
    'todayList=' + S.todoTodayList().length);

  const raw = S.get();
  ok('M7 老表只归档不删除（可回退）',
    raw.longTasks.length === 2 && raw.longTasks.every((o) => o.archived === true && o.migratedTo === 'tasks2'));
  ok('M8 迁移记录写在 meta 里', !!raw.meta.tasksMergedAt);

  // 幂等：再迁移一次不应重复
  const again = S.migrateLongTasksIntoToDos();
  ok('M9 迁移幂等：第二次迁移 0 条、任务数不变',
    again === 0 && S.todoList().length === 2, 'moved=' + again + ' n=' + S.todoList().length);
}

/* ═══════════ 7. 迁移后继续打卡/记一笔都正常 ═══════════ */
{
  const seed = (AR) => {
    const S = AR.Store;
    const st = S.get();
    st.longTasks = [{ id: 'ltX', name: '志愿时长', unit: '小时', target: 20, entries: [{ id: 'e1', amount: 18, at: '2026-10-12T10:00:00.000Z' }] }];
    st.tasks2 = [];
    if (!st.meta) { st.meta = {}; }
    delete st.meta.tasksMergedAt;
    S.save(true); S.load();
  };
  const AR = freshHost(seed);
  const S = AR.Store;
  const t = S.todoList()[0];
  S.todoAddEntry(t.id, 1, '', { src: 'swipe' });
  ok('M10 迁移后打卡：累计 18 → 19', S.todoTotal(t) === 19, 'total=' + S.todoTotal(t));
  S.todoAddEntry(t.id, 1);
  ok('M11 达到目标 20 → 进度 percent=100',
    S.todoProgress(t, new Date()).percent === 100 && S.todoProgress(t, new Date()).done === false,
    j({ percent: S.todoProgress(t, new Date()).percent, periodDone: S.todoProgress(t, new Date()).periodDone, settled: S.todoSettled(t, new Date()) }));
  ok('M12 只设累计、没节奏 → 永不自动收起', S.todoSettled(t, new Date()) === false);
}

/* ═══════════ 8. 与「作业」两表隔离（v0.4.2 真事故的回归） ═══════════
   v0.4.2 第一版里统一任务表用了 `taskList` / `taskRaw` 这两个名字，
   而 core.js 里**作业**早就有同名的 `taskList(semId)` / `taskRaw()`。
   函数声明提升后我的定义把作业那份覆盖掉了 → `taskBoard()`（作业看板）
   读到的是任务表的条目 → 界面上"任务卡里出现作业条目、作业卡串条目"。
   已把统一任务的 API 全部改名成 todo*，这组断言守住这条线。 */
{
  const AR = freshHost();
  const S = AR.Store;
  const st = S.get();
  st.tasks = [{ id: 'hw1', text: '高数作业 P120', done: false, date: null }];
  S.todoUpsert({ text: '背单词', cadence: { type: 'daily', times: 3 }, goal: { target: 100, unit: '页' } });

  ok('X1 作业表只含作业', S.taskList().length === 1 && S.taskList()[0].text === '高数作业 P120',
    S.taskList().map((t) => t.text).join(','));
  ok('X2 任务表只含任务', S.todoList().length === 1 && S.todoList()[0].text === '背单词',
    S.todoList().map((t) => t.text).join(','));
  const board = S.taskBoard(AR.Util.dateKey(new Date()));
  ok('X3 作业看板不串入任务', board.open.length === 1 && board.open[0].text === '高数作业 P120',
    board.open.map((t) => t.text).join(','));
  ok('X4 今日任务列表不串入作业',
    S.todoTodayList().length === 1 && S.todoTodayList()[0].text === '背单词',
    S.todoTodayList().map((t) => t.text).join(','));
  ok('X5 两表底层不是同一个数组', S.get().tasks !== S.get().tasks2, 'tasks 与 tasks2 是两个独立数组');
  /* 命名防线：统一任务 API 必须挂在 todo* 下；core 里再做一次重名扫描 */
  const todoKeys = Object.keys(S).filter((k) => /^todo[A-Z]/.test(k));
  ok('X6 统一任务 API 全部挂在 todo* 命名空间下', todoKeys.length >= 18, 'todo* 键 ' + todoKeys.length + ' 个');
  const coreSrc = fs.readFileSync(path.join(appJs, 'core.js'), 'utf8');
  const fnNames = (coreSrc.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm) || [])
    .map((s) => s.replace(/^\s*function\s+/, '').replace(/\s*\($/, ''));
  const dupFn = fnNames.filter((n, i) => fnNames.indexOf(n) !== i);
  ok('X7 core.js 里没有重名顶层函数（本次事故的类型）', dupFn.length === 0,
    dupFn.length ? '重名: ' + Array.from(new Set(dupFn)).join(',') : '共 ' + fnNames.length + ' 个函数，无重名');
}


/* ═══════════ 9. v0.4.3：统一为「任务」（不再分每日/长期） ═══════════ */
{
  /* v0.4.3 统一模型：不再分每日/长期；未归档即显示 */
  const AR = freshHost();
  const S = AR.Store;
  const A = S.todoUpsert({ text: 'A', cadence: { type: 'daily', times: 1 }, goal: null });
  const B = S.todoUpsert({ text: 'B', cadence: null, goal: { target: 20, unit: '小时' } });
  const C = S.todoUpsert({ text: 'C', cadence: null, goal: null });
  const E = S.todoUpsert({ text: 'E', cadence: { type: 'daily', times: 1 }, goal: null, showInToday: false });
  const names = S.todoTodayList().map((x) => x.text).sort().join(',');
  ok('V1 有计划的显示在今日页', S.todoTodayList().some((x) => x.id === A.id));
  ok('V2 只设目标（老长期任务）也显示在今日页', S.todoTodayList().some((x) => x.id === B.id));
  ok('V3 什么都没设的也显示', S.todoTodayList().some((x) => x.id === C.id));
  ok('V4 没有任何"每日/长期"之分（todoDailyList 与 todoTodayList 同源）',
    S.todoDailyList().length === S.todoTodayList().length,
    S.todoDailyList().length + ' vs ' + S.todoTodayList().length);
  ok('V5 老字段 showInToday=false → 今日页不显示', !S.todoTodayList().some((x) => x.id === E.id));
  ok('V6 今日清单包含所有该显示的（A,B,C）', names === 'A,B,C', 'list=' + names);
  ok('V7 今日清单只含未归档的', S.todoTodayList().every((x) => !x.archived));
}
console.log('\\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
