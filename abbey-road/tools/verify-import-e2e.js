/**
 * 端到端：走真实的 configio.mergePayload（导入按钮的入口），
 * 验证它自己就会完成 longTasks → tasks2 迁移，不需要重启 App。
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
  sb.window = sb; sb.globalThis = sb;
  /* 最小 UI 桩：mergePayload 只用到这些 */
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(appJs, 'core.js'), 'utf8'), sb, { filename: 'core.js' });
  sb.AR.Bridge = { haptic() { }, exportText() { }, shareFile() { }, copy() { } };
  sb.AR.UI = {
    applyTheme() { }, applyModalTuning() { }, applyPerf() { }, applyGlass() { }, applyMotion() { }, toast() { }
  };
  vm.runInContext(fs.readFileSync(path.join(appJs, 'configio.js'), 'utf8'), sb, { filename: 'configio.js' });
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

const sb = host();
const S = sb.AR.Store;
const CI = sb.AR.ConfigIO;

ok('E0 configio 暴露了 mergePayload', !!(CI && CI.mergePayload), CI ? 'AR.ConfigIO ok' : '无');

/* 先放一条本机任务，确认导入不会把它弄丢 */
S.todoUpsert({ text: '本机已有任务', cadence: { type: 'daily', times: 1 }, goal: null });

const res = CI.mergePayload(legacy());
ok('E1 导入返回 ok', !!(res && res.ok), JSON.stringify(res && res.message));

/* 关键：导入之后（不重启）就应该已经迁移完 */
ok('E2 导入后长期任务界面立刻为空（已迁移，不再显示）',
  S.longTaskList().length === 0, 'longTaskList=' + S.longTaskList().length);

const names = S.todoList().map((t) => t.text);
ok('E3 老长期任务已变成任务', names.indexOf('志愿时长') >= 0 && names.indexOf('阅读量') >= 0,
  'list=' + names.join(','));
ok('E4 本机原有任务还在', names.indexOf('本机已有任务') >= 0);
ok('E5 累计量正确（3 / 40）',
  S.todoTotal(S.todoList().filter((t) => t.text === '志愿时长')[0]) === 3 &&
  S.todoTotal(S.todoList().filter((t) => t.text === '阅读量')[0]) === 40);
ok('E6 老记录已归档（可回退）', (S.get().longTasks || []).every((o) => o.archived === true));

/* 再导入一份不同的老配置 */
const c2 = legacy();
c2.longTasks = [{ id: 'oldC', name: '跑步', unit: '公里', target: 50, entries: [] }];
CI.mergePayload(c2);
ok('E7 第二次导入也立刻迁移', S.todoList().some((t) => t.text === '跑步'));
ok('E8 第二次导入后老界面仍为空', S.longTaskList().length === 0);

/* 持久化到 localStorage 的也应是已迁移状态（重启后不会又冒出来） */
S.load();
ok('E9 重新加载（模拟重启）后老界面依旧为空', S.longTaskList().length === 0,
  'longTaskList=' + S.longTaskList().length);
ok('E10 重新加载后任务仍在', S.todoList().length >= 3, 'n=' + S.todoList().length);

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
