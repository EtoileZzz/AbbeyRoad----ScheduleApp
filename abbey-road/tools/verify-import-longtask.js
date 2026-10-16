/** 复现验证：导入老配置后，老长期任务不该复活、应进任务列表 */
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
  vm.runInContext(fs.readFileSync(path.join(appJs, 'core.js'), 'utf8'), sb, { filename: 'core.js' });
  sb.AR.Store.load();
  return sb.AR;
}
function legacyConfig() {
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

/* ── 场景 A：本机已用过新版本（已迁移过），再导入老配置 ── */
{
  const A = host(); const S = A.Store;
  S.todoUpsert({ text: '我新建的任务', cadence: { type: 'daily', times: 1 }, goal: null });
  S.load();
  ok('R0 本机已迁移过（tasksMergedAt 有值）', !!(S.get().meta || {}).tasksMergedAt || (S.get().tasks2 || []).length === 1);
  S.applyMerge(legacyConfig(), {});
  S.load();

  const names = S.todoList().map((t) => t.text);
  ok('R1 老配置的长期任务进了「任务」列表',
    names.indexOf('志愿时长') >= 0 && names.indexOf('阅读量') >= 0, 'list=' + names.join(','));
  ok('R2 老界面不再显示它们（longTaskList 为空）',
    S.longTaskList().length === 0, 'n=' + S.longTaskList().length);
  ok('R3 本机原有任务没丢', names.indexOf('我新建的任务') >= 0);
  ok('R4 老记录确实被归档（可回退）',
    (S.get().longTasks || []).every((o) => o.archived === true),
    (S.get().longTasks || []).map((o) => (o.archived ? '归档' : '活的') + o.name).join(' '));
  ok('R5 累计量并进来了（3 小时 / 40 页）',
    S.todoTotal(S.todoList().filter((t) => t.text === '志愿时长')[0]) === 3 &&
    S.todoTotal(S.todoList().filter((t) => t.text === '阅读量')[0]) === 40);

  /* 再导入同一份：不能变成重复 */
  const before = S.todoList().length;
  S.applyMerge(legacyConfig(), {});
  S.load();
  ok('R6 重复导入老配置不会重复添加任务', S.todoList().length === before,
    'before=' + before + ' after=' + S.todoList().length);
}

/* ── 场景 B：连导入两次不同的老配置 ── */
{
  const B = host(); const S = B.Store;
  S.applyMerge(legacyConfig(), {});
  S.load();
  const c2 = legacyConfig();
  c2.longTasks = [{ id: 'oldC', name: '跑步', unit: '公里', target: 50, entries: [] }];
  S.applyMerge(c2, {});
  S.load();
  const names = S.todoList().map((t) => t.text);
  ok('R7 第二批老配置也能并进来', names.indexOf('跑步') >= 0, 'list=' + names.join(','));
  ok('R8 第一批也没被弄丢', names.indexOf('志愿时长') >= 0 && names.indexOf('阅读量') >= 0);
  ok('R9 仍然没有"活的"老长期任务', S.longTaskList().length === 0);
}

/* ── 场景 C：全新用户导入老配置（首次迁移路径） ── */
{
  const C = host(); const S = C.Store;
  S.applyMerge(legacyConfig(), {});
  S.load();
  ok('R10 首次导入老配置也正常', S.todoList().length === 2, 'n=' + S.todoList().length);
  ok('R11 首次导入后也没有活的长期任务', S.longTaskList().length === 0);
}

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
