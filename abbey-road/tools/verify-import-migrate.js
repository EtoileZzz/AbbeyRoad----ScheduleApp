/**
 * 复现 + 验证：导入流程本身必须完成 longTasks → tasks2 的迁移。
 * （之前只在 load() 里迁移，而导入只调 applyMerge，不重启 App 就永远不迁移）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const appJs = path.join(__dirname, '..', 'app', 'js');
let store = {};
function host() {
  store = {};
  const sb = {
    console, Date, JSON, Math, setTimeout: (f) => { try { f(); } catch (e) { } return 0; }, clearTimeout() { },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  sb.window = sb; sb.globalThis = sb; vm.createContext(sb);
  ['core.js', 'configio.js'].forEach((f) => {
    try { vm.runInContext(fs.readFileSync(path.join(appJs, f), 'utf8'), sb, { filename: f }); } catch (e) { }
  });
  sb.AR.Store.load();
  return sb;
}
function legacy() {
  return {
    kind: 'abbeyroad.sync', schemaVersion: 1, appVersion: '0.3.6',
    semesters: [], courses: [], blocks: [], overrides: [], events: [], tasks: [],
    longTasks: [
      { id: 'oldA', name: '志愿时长', unit: '小时', target: 20, entries: [{ id: 'e1', amount: 3, at: '2026-10-10T10:00:00.000Z' }] },
      { id: 'oldB', name: '阅读量', unit: '页', target: 100, entries: [{ id: 'e2', amount: 40, at: '2026-10-11T10:00:00.000Z' }] }
    ],
    tombstones: []
  };
}

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('[PASS] ' + n + (d ? '  |  ' + d : '')); } else { fail++; console.log('[FAIL] ' + n + (d ? '  |  ' + d : '')); } }

/* ── 直接走 applyMerge（导入的真实入口），不重启 ── */
{
  const sb = host();
  const S = sb.AR.Store;
  S.applyMerge(legacy(), {});
  console.log('  [applyMerge 之后、跑迁移之前] longTaskList =', S.longTaskList().length, ' todoList =', S.todoList().length);

  ok('M1 applyMerge 之后必须存在迁移入口 migrateNow', typeof S.migrateNow === 'function',
    'typeof=' + typeof S.migrateNow);
  if (typeof S.migrateNow === 'function') {
    const moved = S.migrateNow();
    ok('M2 导入后立刻迁移，移动了 2 条', moved === 2, 'moved=' + moved);
    ok('M3 老长期任务界面清空（不再显示）', S.longTaskList().length === 0,
      'longTaskList=' + S.longTaskList().length);
    const names = S.todoList().map((t) => t.text);
    ok('M4 两条都进了任务列表', names.indexOf('志愿时长') >= 0 && names.indexOf('阅读量') >= 0, 'list=' + names.join(','));
    ok('M5 累计量正确（3 / 40）',
      S.todoTotal(S.todoList().filter((t) => t.text === '志愿时长')[0]) === 3 &&
      S.todoTotal(S.todoList().filter((t) => t.text === '阅读量')[0]) === 40);
    ok('M6 迁移幂等：再跑一次 0 条', S.migrateNow() === 0 && S.todoList().length === 2);
    ok('M7 老记录被归档（可回退）', (S.get().longTasks || []).every((o) => o.archived === true));
  }
}

/* ── 再模拟一次：连导入两份老配置，每份都要立刻迁移 ── */
{
  const sb = host();
  const S = sb.AR.Store;
  S.applyMerge(legacy(), {});
  if (S.migrateNow) { S.migrateNow(); }
  const c2 = legacy();
  c2.longTasks = [{ id: 'oldC', name: '跑步', unit: '公里', target: 50, entries: [] }];
  S.applyMerge(c2, {});
  if (S.migrateNow) { S.migrateNow(); }
  const names = S.todoList().map((t) => t.text);
  ok('M8 第二份老配置也立刻迁移', names.indexOf('跑步') >= 0, 'list=' + names.join(','));
  ok('M9 迁移后老界面仍然为空', S.longTaskList().length === 0, 'n=' + S.longTaskList().length);
}

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
