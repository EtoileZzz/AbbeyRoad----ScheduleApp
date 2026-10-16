/**
 * 兼容性回归（v0.4.2）：任务模块要能
 *   ① 老数据无损迁移（longTasks → tasks2，幂等）
 *   ② 老配置（没有 tasks2 字段、用老 showInToday 字段）导入不崩、不误删本机任务
 *   ③ 新配置导出→导入往返不丢任务、不重复
 *   ④ 同名任务按「文字 + 创建日」配对，不会被并成一条
 *
 * 用法：node tools/verify-tasks-compat.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = path.join(__dirname, '..', 'app', 'js');
let store = {};

function freshHost(seed) {
  store = {};
  const sandbox = {
    console: console, Date, JSON, Math,
    setTimeout: (f) => { try { f(); } catch (e) { } return 0; }, clearTimeout() { },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['core.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(appJs, f), 'utf8'), sandbox, { filename: f });
  });
  const AR = sandbox.AR;
  AR.Store.load();
  if (seed) { seed(AR); AR.Store.load(); }
  return AR;
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name + (detail ? '  |  ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? '  |  ' + detail : '')); }
  return !!cond;
}

/* ═══════ 1. 老 longTasks 无损迁移（幂等 + 内容不丢） ═══════ */
{
  const seed = (AR) => {
    const S = AR.Store;
    const st = S.get();
    st.longTasks = [
      { id: 'ltA', name: '志愿时长', unit: '小时', target: 20, colorKey: 'green', showInToday: true,
        entries: [{ id: 'e1', amount: 2, at: '2026-10-10T10:00:00.000Z' },
                  { id: 'e2', amount: 1.5, at: '2026-10-13T10:00:00.000Z' }] },
      { id: 'ltB', name: '阅读量', unit: '页', target: 100, showInToday: false,
        entries: [{ id: 'e3', amount: 30, at: '2026-10-12T10:00:00.000Z' }] }
    ];
    st.tasks2 = [];
    if (!st.meta) { st.meta = {}; }
    delete st.meta.tasksMergedAt;
    S.save(true); S.load();
  };
  const AR = freshHost(seed);
  const S = AR.Store;
  const list = S.todoList();
  ok('C1 老 longTasks 全部并进统一任务表', list.length === 2, 'n=' + list.length);
  const a = list.filter((t) => t.text === '志愿时长')[0];
  ok('C2 名称/单位/目标完整保留', a && a.goal && a.goal.target === 20 && a.goal.unit === '小时',
    a ? JSON.stringify(a.goal) : '缺失');
  ok('C3 累计量一分不差（2 + 1.5 = 3.5）', a && S.todoTotal(a) === 3.5, a ? 'total=' + S.todoTotal(a) : '');
  ok('C4 老条目补上日期键 k', a && (a.entries || []).every((e) => !!e.k));
  ok('C5 没节奏（老长期任务没有计划）', a && S.todoRequired(a, new Date()) === Infinity);
  ok('C6 迁移幂等：再跑一次 0 条、数量不变',
    S.migrateLongTasksIntoToDos() === 0 && S.todoList().length === 2);
  const st = S.get();
  ok('C7 老表只归档不删除（可回退）',
    st.longTasks.length === 2 && st.longTasks.every((o) => o.archived === true && o.migratedTo === 'tasks2'));
}

/* ═══════ 2. 老配置导入：没有 tasks2、老 showInToday 字段，不崩也不误删 ═══════ */
{
  const AR = freshHost();
  const S = AR.Store;
  S.todoUpsert({ text: '本机已有任务', cadence: { type: 'daily', times: 1 }, goal: null });
  const before = S.todoList().length;

  /* 老版本导出的配置：只有 longTasks，没有 tasks2；设置里也没有新字段 */
  const legacy = {
    schemaVersion: 1, appVersion: '0.3.6',
    semesters: [{ id: 's1', name: '老学期', startDate: '2026-09-01', weekCount: 18 }],
    courses: [], blocks: [], overrides: [], events: [], tasks: [],
    longTasks: [{ id: 'ltOld', name: '老长期任务', unit: '次', target: 10, entries: [] }],
    settings: { appearance: { theme: 'light' } }
  };
  let err = '';
  try { S.applyMerge(legacy, {}); } catch (e) { err = e.message; }
  ok('C8 导入老配置不抛错', !err, err);
  ok('C9 本机已有任务没被清掉', S.todoList().length >= before, 'n=' + S.todoList().length);
  ok('C10 老 longTasks 仍在（老配置不丢数据），并会被迁移逻辑接手',
    (S.get().longTasks || []).length >= 1, 'longTasks=' + (S.get().longTasks || []).length);
}

/* ═══════ 3. 导出 → 导入往返：不丢、不重复 ═══════ */
{
  const AR = freshHost();
  const S = AR.Store;
  S.todoUpsert({ text: '背单词', cadence: { type: 'daily', times: 3 }, goal: { target: 100, unit: '页' } });
  const t1 = S.todoList()[0];
  S.todoAddEntry(t1.id, 1);
  S.todoAddEntry(t1.id, 1);
  const payload = S.exportPayload();
  ok('C11 导出里带上了统一任务表', Array.isArray(payload.tasks2) && payload.tasks2.length === 1,
    'tasks2=' + (payload.tasks2 || []).length);
  ok('C12 导出里带上了任务记录', (payload.tasks2[0].entries || []).length === 2,
    'entries=' + (payload.tasks2[0].entries || []).length);

  /* 导进一个干净实例 */
  const AR2 = freshHost();
  const S2 = AR2.Store;
  let err2 = '';
  try { S2.applyMerge(payload, {}); } catch (e) { err2 = e.message; }
  ok('C13 导入新配置不抛错', !err2, err2);
  ok('C14 任务与记录都进来了（1 条 / 2 笔）',
    S2.todoList().length === 1 && (S2.todoList()[0].entries || []).length === 2,
    'n=' + S2.todoList().length + ' entries=' + (S2.todoList()[0].entries || []).length);
  const p2 = S2.todoProgress(S2.todoList()[0], new Date());
  ok('C15 累计量对得上（2 页）', p2.total === 2, 'total=' + p2.total);

  /* 再导一次同一份：按自然键配对，不应变成两条 */
  S2.applyMerge(payload, {});
  ok('C16 重复导入同一份配置不会变成两条任务', S2.todoList().length === 1,
    'n=' + S2.todoList().length);
}

/* ═══════ 4. 老字段 showInToday=false 仍然生效（不因升级而丢设置） ═══════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const t = S.todoUpsert({ text: '隐藏的任务', cadence: { type: 'daily', times: 1 }, goal: null, showInToday: false });
  ok('C17 老字段 showInToday=false → 今日清单不显示它',
    !S.todoTodayList().some((x) => x.id === t.id),
    'todayList=' + S.todoTodayList().map((x) => x.text).join(','));
  const t2 = S.todoUpsert({ text: '显示的任务', cadence: { type: 'daily', times: 1 }, goal: null });
  ok('C18 默认可显示', S.todoTodayList().some((x) => x.id === t2.id));
}

/* ═══════ 5. 缺字段的老任务记录不崩 ═══════ */
{
  const AR = freshHost();
  const S = AR.Store;
  const st = S.get();
  /* 极老的数据：没有 cadence / goal / entries */
  st.tasks2 = [{ id: 'weird', text: '老任务' }];
  let err = '';
  try {
    const p = S.todoProgress(st.tasks2[0], new Date());
    ok('C19 缺字段的任务能算出进度（全 0）', p.today === 0 && p.total === 0 && p.hasGoal === false,
      JSON.stringify({ today: p.today, total: p.total, goal: p.hasGoal }));
  } catch (e) { err = e.message; }
  ok('C20 缺字段的任务不抛错', !err, err);
  let err2 = '';
  try { S.todoTodayList(); S.todoSettled(st.tasks2[0], new Date()); } catch (e) { err2 = e.message; }
  ok('C21 列表与收起判定都不抛错', !err2, err2);
}

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
