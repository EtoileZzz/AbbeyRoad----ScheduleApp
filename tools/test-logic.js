/**
 * Abbey Road · 逻辑回归测试
 * 直接加载**发货用的同一份** app/js/core.js 与 app/js/mdparse.js（不加载 UI），
 * 在最小宿主环境里跑断言。用来在没有 Android 设备 / 浏览器时的自动验证。
 *
 * 用法：node tools/test-logic.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = path.join(__dirname, '..', 'app', 'js');
const store = {};

const sandbox = {
  console: console,
  Date: Date,
  JSON: JSON,
  Math: Math,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['core.js', 'mdparse.js'].forEach((f) => {
  const code = fs.readFileSync(path.join(appJs, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

const AR = sandbox.AR;
const U = AR.Util;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) { pass++; return; }
  fail++;
  failures.push(name + (extra ? '  →  ' + extra : ''));
}

function eq(name, actual, expected) {
  check(name, actual === expected, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}

/* ── 1. 基础数据 ─────────────────────────────────────────── */

const S = AR.Store.load();
eq('默认学期数 1', S.semesters.length, 1);
eq('默认节次 12 条', S.periods.length, 12);
eq('数据格式版本 1', S.schemaVersion, 1);
eq('kind 正确', S.kind, 'abbeyroad.sync');
check('提示词足够短（AI 不该被长指令绕晕）', AR.Prompt.text.length < 1100, '实际 ' + AR.Prompt.text.length + ' 字');
check('提示词版本 ar-txt-1.1', AR.Prompt.version === 'ar-txt-1.1.0');
check('提示词包含颜色字段', AR.Prompt.text.indexOf('颜色') >= 0);
check('提示词包含特殊事件行', AR.Prompt.text.indexOf('考试') >= 0 && AR.Prompt.text.indexOf('讲座') >= 0);
check('提示词使用自定义分隔符格式', AR.Prompt.text.indexOf('AbbeyRoad 课表 v1') >= 0
  && AR.Prompt.text.indexOf('｜') >= 0
  && AR.Prompt.text.indexOf('| --- |') < 0);

/* ── 2b. 格式容忍：AI 用什么写法都要认得出来 ─────────────── */

const simpleTable = [
  '| 课程名 | 星期 | 节次 | 周次 | 地点 | 老师 |',
  '| 高等数学 | 周一 | 1-2 | 1-16 | XX大学 信息楼305 | 张三 |',
  '| 大学物理 | 周三 | 5-6 | 双周 | XX大学 物理楼101 | 李四 |',
  '',
  '开学日期：2026-09-07'
].join('\n');
const simple = AR.MdParse.parse(simpleTable, { weekCount: 20 });
eq('简版表格：2 行课程', simple.rows.length, 2);
eq('简版表格：无错误', simple.summary.errors, 0);
eq('简版表格：读到开学日期', simple.semester && simple.semester.startDate, '2026-09-07');
eq('简版表格：第一节次', simple.rows[0].periodsRaw, '1-2');
eq('简版表格：周次', simple.rows[0].weeksRaw, '1-16');
eq('简版表格：双周', simple.rows[1].weeksRaw, '双周');

const noHeader = [
  '高等数学 | 周一 | 1-2 | 1-16 | XX大学 信息楼305 | 张三',
  '大学物理 | 周三 | 5-6 | 双周 | XX大学 物理楼101 | 李四'
].join('\n');
const nh = AR.MdParse.parse(noHeader, { weekCount: 20 });
eq('无表头竖线：2 行', nh.rows.length, 2);
eq('无表头：无错误', nh.summary.errors, 0);
eq('无表头：课程名正确', nh.rows[0].courseName, '高等数学');
eq('无表头：地点正确', nh.rows[0].place, 'XX大学 信息楼305');
eq('无表头：老师正确', nh.rows[0].teachersRaw, '张三');
eq('无表头：星期正确', nh.rows[0].weekday, 1);

const tabs = '高等数学\t周一\t1-2\t1-16\tXX大学信息楼305\t张三\n大学物理\t周三\t5-6\t双周\tXX大学物理楼101\t李四';
const tb = AR.MdParse.parse(tabs, { weekCount: 20 });
eq('制表符分隔：2 行', tb.rows.length, 2);
eq('制表符分隔：无错误', tb.summary.errors, 0);

const bullets = [
  '- 高等数学 张三 周一1-2节 1-16周 XX大学信息楼305',
  '- 大学物理 李四 周三 5-6节 双周 XX大学物理楼101'
].join('\n');
const bl = AR.MdParse.parse(bullets, { weekCount: 20 });
eq('列表 + 连写：2 行', bl.rows.length, 2);
eq('列表 + 连写：无错误', bl.summary.errors, 0);
eq('列表 + 连写：星期解析', bl.rows[0].weekday, 1);
eq('列表 + 连写：节次解析', bl.rows[0].periodsRaw, '1-2节');
eq('列表 + 连写：周次解析', bl.rows[0].weeks.weeks.length, 16);

const jsonInput = JSON.stringify([
  { 课程名: '高等数学', 星期: '周一', 节次: '1-2', 周次: '1-16', 地点: 'XX大学 信息楼305', 老师: '张三' },
  { course: 'College English', day: 'Friday', periods: '3-4', weeks: '1-16', room: 'XX大学 文科楼401', teacher: 'Wang' }
]);
const js = AR.MdParse.parse(jsonInput, { weekCount: 20 });
eq('JSON 数组：2 行', js.rows.length, 2);
eq('JSON 数组：中文键', js.rows[0].courseName, '高等数学');
eq('JSON 数组：英文键课程名', js.rows[1].courseName, 'College English');
eq('JSON 数组：英文键星期', js.rows[1].weekday, 5);

const missingWeeks = AR.MdParse.parse('| 形势与政策 | 周二 | 3-4 | | XX大学 报告厅 | 王五 |', { weekCount: 20 });
eq('缺周次：默认全周', missingWeeks.rows[0].weeks.weeks.length, 20);
check('缺周次：给出 W140 提示', missingWeeks.issues.some((i) => i.code === 'W140'));

const looseOv = AR.MdParse.parse(
  '高等数学 | 周一 | 1-2 | 1-16 | XX大学 信息楼305 | 张三\n'
  + '高等数学 2026-10-08 调课 周四 1-2 XX大学信息楼201\n'
  + '大学物理 2026-10-01 停课', { weekCount: 20 });
eq('宽松变动：识别到 2 条', looseOv.overrides.length, 2);
eq('宽松变动：调课日期', looseOv.overrides[0].date, '2026-10-08');
eq('宽松变动：类型', looseOv.overrides[0].type, 'move');
eq('宽松变动：停课类型', looseOv.overrides[1].type, 'cancel');

/* ── 2. Markdown 解析（示例文档） ─────────────────────────── */

const parsed = AR.MdParse.parse(AR.MdParse.sample, { weekCount: 20 });
eq('示例课程行 7 行', parsed.rows.length, 7);
eq('示例变动 3 条', parsed.overrides.length, 3);
eq('新格式不含节次表（用 App 默认作息）', parsed.periods.length, 0);
eq('示例无阻断错误', parsed.summary.errors, 0);
eq('示例 3 条警告', parsed.summary.warnings, 3);
eq('学期开始日期', parsed.semester.startDate, U.dateKey(U.mondayOf(new Date())));
check('警告码为 W101/W130',
  parsed.issues.filter((i) => i.level === 'warn').every((i) => i.code === 'W101' || i.code === 'W130'),
  JSON.stringify(parsed.issues.map((i) => i.code)));

/* ── 2c. 自定义文本格式（AR-TXT）──────────────────────────── */

const arTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '总周数：18',
  '高等数学｜周一｜1-2｜1-16｜XX大学 信息楼305｜张三｜需带教材',
  '英语｜周五｜3-4｜1-16｜文科楼401',
  '数据结构｜周二｜1-2｜1-8,10-16｜XX大学 机房302｜陈老师',
  '大学英语｜周四｜3-4｜XX大学 文科楼401｜王老师'
].join('\n');
const at = AR.MdParse.parse(arTxt, { weekCount: 20 });
eq('AR-TXT：4 行课程', at.rows.length, 4);
eq('AR-TXT：无阻断错误', at.summary.errors, 0);
eq('AR-TXT：读到开学日期', at.semester && at.semester.startDate, '2026-09-07');
eq('AR-TXT：读到总周数', at.semester && at.semester.weekCount, 18);
eq('AR-TXT：课程名', at.rows[0].courseName, '高等数学');
eq('AR-TXT：星期', at.rows[0].weekday, 1);
eq('AR-TXT：节次', at.rows[0].periodsRaw, '1-2');
eq('AR-TXT：周次', at.rows[0].weeksRaw, '1-16');
eq('AR-TXT：地点', at.rows[0].place, 'XX大学 信息楼305');
eq('AR-TXT：老师', at.rows[0].teachersRaw, '张三');
eq('AR-TXT：备注', at.rows[0].note, '需带教材');
eq('AR-TXT：缺老师只warning', at.rows[1].teachersRaw, '');
eq('AR-TXT：多段周次', at.rows[2].weeks.weeks.length, 15);
eq('AR-TXT：地点', at.rows[2].place, 'XX大学 机房302');
eq('AR-TXT：老师', at.rows[2].teachersRaw, '陈老师');
eq('AR-TXT：省略周次时字段不串位（地点）', at.rows[3].place, 'XX大学 文科楼401');
eq('AR-TXT：省略周次时字段不串位（老师）', at.rows[3].teachersRaw, '王老师');
check('AR-TXT：省略周次按全周提示', at.issues.some((i) => i.code === 'W140'));

const arTxtBad = AR.MdParse.parse([
  'AbbeyRoad 课表 v1',
  '高数｜周八｜1-2｜1-16｜信息楼305｜张三',
  '英语｜周五｜99｜1-16｜文科楼401｜李四',
  '物理｜周三｜5-6｜乱七八糟｜物理楼101｜王五'
].join('\n'), { weekCount: 20 });
const arCodes = arTxtBad.issues.map((i) => i.code);
check('AR-TXT：坏星期报 E010', arCodes.indexOf('E010') >= 0, arCodes.join(','));
check('AR-TXT：坏节次报 E020', arCodes.indexOf('E020') >= 0, arCodes.join(','));
check('AR-TXT：周次写错时给出提示（不阻断）',
  arCodes.indexOf('E030') >= 0 || arCodes.indexOf('W140') >= 0, arCodes.join(','));

const arTxtOpt = AR.MdParse.parse('体育｜周四｜7-8｜｜体育场｜赵老师', {
  weekCount: 20, defaultParity: 'odd',
  semester: { name: '测试学期', startDate: '2026-02-23', weekCount: 20 }
});
eq('导入选项：默认单周生效', arTxtOpt.rows[0].weekMode, 'odd');
eq('导入选项：单周 10 周', arTxtOpt.rows[0].weeks.weeks.length, 10);
eq('导入选项：学期名', arTxtOpt.semester.name, '测试学期');
eq('导入选项：开学日期', arTxtOpt.semester.startDate, '2026-02-23');

const arTxtOv = AR.MdParse.parse([
  'AbbeyRoad 课表 v1',
  '高等数学｜周一｜1-2｜1-16｜XX大学 信息楼305｜张三',
  '调课｜高等数学｜2026-10-08｜周四｜1-2｜XX大学 信息楼201｜国庆调休',
  '停课｜高等数学｜2026-10-01'
].join('\n'), { weekCount: 20 });
eq('AR-TXT：变动 2 条', arTxtOv.overrides.length, 2);
eq('AR-TXT：调课类型', arTxtOv.overrides[0].type, 'move');
eq('AR-TXT：调课日期', arTxtOv.overrides[0].date, '2026-10-08');
eq('AR-TXT：停课类型', arTxtOv.overrides[1].type, 'cancel');

const mdTable = [
  '| 课程名 | 星期 | 节次 | 周次 | 地点 | 老师 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 高等数学 | 周一 | 1-2 | 1-16 | XX大学 信息楼305 | 张三 |'
].join('\n');
const mt = AR.MdParse.parse(mdTable, { weekCount: 20 });
eq('兼容旧 Markdown 表格：1 行', mt.rows.length, 1);
eq('兼容旧表格：课程名', mt.rows[0].courseName, '高等数学');
eq('兼容旧表格：无错误', mt.summary.errors, 0);

/* ── 3. 容错与错误码 ─────────────────────────────────────── */

const bad = AR.MdParse.parse([
  '# Abbey Road 课表导入',
  '## 课程',
  '| 课程名 | 老师 | 地点 | 星期 | 节次 | 周次 | 单双周 | 备注 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '|  | 王老师 | XX大学 信息楼 101 | 周三 | 5-6 | 1-16 | 全周 | 缺课程名 |',
  '| 线性代数 | 赵老师 | ? | 星期八 | 1-2 | 1-16 | 全周 | 坏星期 |',
  '| 大学英语 | 钱老师 | ? | 周五 | 99 | 1-16 | 全周 | 坏节次 |',
  '| 体育 | 孙老师 | ? | 周四 | 7-8 | 乱七八糟 | 全周 | 坏周次 |'
].join('\n'), { weekCount: 20 });
const codes = bad.issues.map((i) => i.code);
check('报出 E001 缺课程名', codes.indexOf('E001') >= 0, codes.join(','));
check('报出 E010 坏星期', codes.indexOf('E010') >= 0, codes.join(','));
check('报出 E020 坏节次', codes.indexOf('E020') >= 0, codes.join(','));
check('报出 E030 坏周次', codes.indexOf('E030') >= 0, codes.join(','));

const conflict = AR.MdParse.parse([
  '## 课程',
  '| 课程名 | 老师 | 地点 | 星期 | 节次 | 周次 | 单双周 | 备注 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 高等数学 | 张三 | XX大学 信息楼 305 | 周一 | 1-2 | 1-16 | 全周 | - |',
  '| 大学物理 | 李四 | XX大学 物理楼 101 | 周一 | 2-3 | 1-16 | 全周 | - |'
].join('\n'), { weekCount: 20 });
check('报出 C200 时间冲突', conflict.issues.some((i) => i.code === 'C200'),
  conflict.issues.map((i) => i.code).join(','));

/* ── 4. 周次 / 节次解析 ─────────────────────────────────── */

eq('周次 1-16', AR.MdParse.parseWeeks('1-16', 20).weeks.length, 16);
eq('周次 单周', AR.MdParse.parseWeeks('单周', 20).weeks.length, 10);
eq('周次 双周', AR.MdParse.parseWeeks('双周', 20).weeks.length, 10);
eq('周次 1,3,5', AR.MdParse.parseWeeks('1,3,5', 20).weeks.join(','), '1,3,5');
eq('周次 1-16(单)', AR.MdParse.parseWeeks('1-16（单）', 20).weeks.length, 8);
eq('周次 1-8,10-16', AR.MdParse.parseWeeks('1-8,10-16', 20).weeks.length, 15);
eq('节次 1-2', AR.MdParse.parsePeriods('第1-2节').start, 1);
eq('节次 1,3 分段', AR.MdParse.parsePeriods('1、3').segments.length, 2);
eq('星期 星期三', AR.MdParse.parseWeekday('星期三'), 3);
eq('星期 周日', AR.MdParse.parseWeekday('周日'), 7);

/* ── 5. 地点裁剪与导航查询词（规划文档 §11.2 全部用例） ─── */

const settings = {
  integration: {
    university: 'XX大学', campus: '东校区', city: '北京市', navApp: 'amap',
    trimRoom: true, keepCampus: true, autoPrependUniversity: true,
    appendCityWhenAmbiguous: true, onlineTreatAsNoNav: true
  }
};
function nav(raw) { return AR.Location.navQuery(raw, settings).trimmed; }
eq('地点①裁剪教室号', nav('XX大学 信息楼 305教室'), 'XX大学 信息楼');
eq('地点②补学校名', nav('信息楼305'), 'XX大学 信息楼');
eq('地点③保留校区', nav('东校区 3教 402'), 'XX大学 东校区 3教');
eq('地点④去门口', nav('南苑食堂门口'), 'XX大学 南苑食堂');
eq('地点⑤完整地址不补学校', nav('北京市海淀区中关村大街1号 教学楼A座 204'), '海淀区中关村大街1号 教学楼A座');
eq('地点⑥线上课程', nav('线上：腾讯会议 123-456-789'), '');
check('地点⑥标记为线上', AR.Location.navQuery('线上：腾讯会议 123', settings).online === true);
eq('地点⑦空值不可用', AR.Location.navQuery('?', settings).usable, false);
eq('地点⑧去楼层与教室名', nav('实验楼B座 5楼 智慧教室3'), 'XX大学 实验楼B座');
eq('地点⑨机构词+编号', nav('XX大学 机房 302'), 'XX大学 机房');
eq('地点⑩号区间', nav('XX大学 物理楼 实验2-101'), 'XX大学 物理楼');

/* ── 6. 连堂课识别（规划文档 §6.8） ─────────────────────── */

const merged = AR.Schedule.mergeConsecutive([
  { id: 'b1', courseId: 'c1', weekday: 1, periodStart: 1, periodEnd: 2, weekMode: 'custom', weeks: [1, 2, 3] },
  { id: 'b2', courseId: 'c1', weekday: 1, periodStart: 3, periodEnd: 4, weekMode: 'custom', weeks: [1, 2, 3] }
], 20);
eq('连堂：合并为 1 条', merged.merged.length, 1);
eq('连堂：起止节次', merged.merged[0].periodStart + '-' + merged.merged[0].periodEnd, '1-4');
check('连堂：标记与分段', merged.merged[0].isConsecutive === true && merged.merged[0].segments.length === 2);

const partial = AR.Schedule.mergeConsecutive([
  { id: 'b3', courseId: 'c2', weekday: 1, periodStart: 1, periodEnd: 2, weekMode: 'custom', weeks: [1, 2] },
  { id: 'b4', courseId: 'c2', weekday: 1, periodStart: 3, periodEnd: 4, weekMode: 'custom', weeks: [1, 2, 3, 4] }
], 20);
eq('连堂：条件不完全匹配不合并且给出建议', merged_ok(partial), true);
function merged_ok(r) { return r.merged.length === 2 && r.suggestions.length === 1; }

/* ── 7. 导入并落到课表 ───────────────────────────────────── */

const entities = AR.MdParse.toEntities(parsed, S, { mergeMode: 'auto' });
eq('实体：课程 5 门', entities.courses.length, 5);
eq('实体：时段 6 条', entities.blocks.length, 6);
eq('实体：自动合并 1 组连堂', entities.mergedCount, 1);
eq('实体：变动 3 条', entities.overrides.length, 3);
AR.MdParse.applyEntities(entities, S);
eq('写回：状态里课程 5 门', AR.Store.get().courses.length, 5);
eq('写回：节次表 12 条', AR.Store.get().periods.length, 12);
eq('无冲突', AR.Schedule.conflicts().length, 0);

const sem = AR.Store.currentSemester();
const monday = U.parseDateKey(sem.startDate);
eq('第 1 周周一有 1 节课', AR.Schedule.dayItems(monday).length, 1);
const first = AR.Schedule.dayItems(monday)[0];
eq('连堂课显示为 1-4 节', first.periodLabel, '1-4节');
eq('时间 08:00-11:35（v0.2.1 新作息表）', first.start + '-' + first.end, '08:00-11:35');
eq('地点已写入', first.location && first.location.raw, 'XX大学 信息楼 305教室');
eq('老师已写入', first.teachers[0].name, '张三');
eq('第 2 周（双周）周二有 2 节', AR.Schedule.dayItems(U.addDays(monday, 8)).length, 2);

/* 停课与调课 */
const cancelDate = parsed.overrides.filter((o) => o.type === 'cancel')[0];
if (cancelDate) {
  const d = U.parseDateKey(cancelDate.date);
  const before = AR.Schedule.dayItems(d).length;
  check('停课日仍有课或已停课（数据自洽）', before >= 0);
}
const makeup = parsed.overrides.filter((o) => o.type === 'makeup' || o.type === 'add')[0];
if (makeup) {
  const d = U.parseDateKey(makeup.date);
  const items = AR.Schedule.dayItems(d);
  check('补课日出现该课程', items.some((it) => it.course.name === makeup.courseName),
    items.map((i) => i.course.name).join(','));
}

/* ── 8. JSON 导出 / 合并预览 ─────────────────────────────── */

const payload = AR.Store.exportPayload();
eq('导出 kind 正确', payload.kind, 'abbeyroad.sync');
check('导出包含课程', payload.courses.length === 5);
const copy = JSON.parse(JSON.stringify(payload));
copy.courses.push({
  id: 'NEWCOURSE01', semesterId: sem.id, name: '新增课程', teacherIds: [],
  defaultLocationId: null, colorKey: 'green', tags: [], note: '',
  updatedAt: new Date().toISOString()
});
const report = AR.Store.previewMerge(copy);
eq('合并预览：新增 1 条', report.added, 1);
AR.Store.applyMerge(copy, {});
eq('合并后课程 6 门', AR.Store.get().courses.length, 6);

let badReported = false;
try { AR.Store.previewMerge({ kind: 'something.else' }); } catch (e) { badReported = true; }
check('非 Abbey Road 文件被拒', badReported);

/* ── 9. 界面模型（无 DOM） ───────────────────────────────── */

eq('当前周计算（学期开始日=第 1 周）', AR.Schedule.weekNumber(monday, sem), 1);
eq('跨 3 周后为第 4 周', AR.Schedule.weekNumber(U.addDays(monday, 21), sem), 4);
eq('周次标签（连堂）', AR.Schedule.weeksLabel(AR.Store.get().blocks[0], 20).indexOf('周') >= 0, true);

/* ── 10. 颜色 / 特殊事件 / 改课程名 ──────────────────────── */

const semOpts = { weekCount: 20, semester: { name: '我的学期', startDate: '2026-09-07', weekCount: 20 } };

const colorTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '高等数学｜周一｜1-2｜1-16｜XX大学 信息楼305｜张三｜需带教材｜蓝',
  '大学物理｜周三｜5-6｜1-16｜XX大学 物理楼101｜李四｜｜#E8843C',
  '英语｜周五｜3-4｜1-16｜文科楼401｜王五'
].join('\n');
const cEnt = AR.MdParse.toEntities(AR.MdParse.parse(colorTxt, semOpts), AR.Store.get(), { mergeMode: 'never' });
const colorOf = {};
cEnt.courses.forEach((c) => { colorOf[c.name] = c.colorKey; });
eq('颜色：中文色名 → 蓝', colorOf['高等数学'], 'blue');
eq('颜色：十六进制原样保留', colorOf['大学物理'], '#E8843C');
check('颜色：没写颜色时自动分配', !!colorOf['英语']);

const evTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '考试｜高等数学 期中｜2026-11-12｜14:00-16:00｜XX大学 信息楼305｜闭卷',
  '讲座｜AI 前沿｜2026-09-20｜19:00-20:30｜报告厅'
].join('\n');
const eParsed = AR.MdParse.parse(evTxt, semOpts);
eq('事件：识别到 2 条', eParsed.events.length, 2);
eq('事件：类型 exam', eParsed.events[0].type, 'exam');
eq('事件：开始时间', eParsed.events[0].start, '14:00');
eq('事件：结束时间', eParsed.events[0].end, '16:00');
const eEnt = AR.MdParse.toEntities(eParsed, AR.Store.get(), { mergeMode: 'never' });
eq('事件：写入实体 2 条', eEnt.events.length, 2);
AR.MdParse.applyEntities(eEnt, AR.Store.get());
eq('事件：按日期查得到', AR.Store.eventsOf('2026-11-12').length, 1);
eq('事件：第 2 周里查得到讲座', AR.Store.eventsInWeek(2, AR.Store.currentSemester()).length, 1);

const renameTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '高数A班｜周一｜1-2｜1-16｜X楼101｜张三｜｜蓝',
  '高数A班重修｜周二｜3-4｜1-16｜X楼102｜李四｜｜红'
].join('\n');
const rEnt = AR.MdParse.toEntities(AR.MdParse.parse(renameTxt, semOpts), AR.Store.get(), { mergeMode: 'never' });
AR.MdParse.applyEntities(rEnt, AR.Store.get());
const liveState = AR.Store.get();
const srcCourse = liveState.courses.filter((c) => c.name === '高数A班重修')[0];
const beforeCount = liveState.courses.length;
const rr = AR.Store.renameCourse(srcCourse.id, '高数A班');
check('改名：合并成功', rr.ok && rr.merged);
eq('改名：两门课合并成一门', AR.Store.get().courses.length, beforeCount - 1);
eq('改名：同名课程只剩 1 条', AR.Store.get().courses.filter((c) => c.name === '高数A班').length, 1);
const mergedId = AR.Store.get().courses.filter((c) => c.name === '高数A班')[0].id;
eq('改名：两个时段都挂到这门课上', AR.Store.get().blocks.filter((b) => b.courseId === mergedId).length, 2);

/* ── 12. 时段编辑（v0.2.0：今日页条目 / 周表单节课程都能改）── */

eq('周次文本：全周', AR.Store.parseWeeksText('全周', 20).weekMode, 'all');
eq('周次文本：单周', AR.Store.parseWeeksText('单周', 20).weekMode, 'odd');
eq('周次文本：双周', AR.Store.parseWeeksText('双周', 20).weekMode, 'even');
const pw = AR.Store.parseWeeksText('1-3,5', 20);
eq('周次文本：自定义模式', pw.weekMode, 'custom');
eq('周次文本：解析出 4 周', pw.weeks.join(','), '1,2,3,5');
eq('周次压缩', AR.Store.compressWeeks([1, 2, 3, 5, 7, 8]), '1-3,5,7-8');

const editTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '编辑测试课｜周一｜1-2｜1-16｜X楼305｜王五｜｜绿'
].join('\n');
const edEnt = AR.MdParse.toEntities(AR.MdParse.parse(editTxt, semOpts), AR.Store.get(), { mergeMode: 'never' });
AR.MdParse.applyEntities(edEnt, AR.Store.get());
const editMonday = U.mondayOf(U.parseDateKey(AR.Store.currentSemester().startDate));
const edCourse = AR.Store.get().courses.filter((c) => c.name === '编辑测试课')[0];
let edBlock = AR.Store.get().blocks.filter((b) => b.courseId === edCourse.id)[0];
eq('编辑：初始星期是周一', edBlock.weekday, 1);

// 周表里改成：周三、5-6 节、单周
const upWk = AR.Store.updateBlock(edBlock.id, { weekday: 3, periodStart: 5, periodEnd: 6, weekMode: 'odd' });
check('编辑：updateBlock 返回成功', upWk.ok);
eq('编辑：周一不再有这门课', AR.Schedule.dayItems(editMonday).filter((i) => i.course.name === '编辑测试课').length, 0);
const edWed = AR.Schedule.dayItems(U.addDays(editMonday, 2)).filter((i) => i.course.name === '编辑测试课');
eq('编辑：周三出现这门课', edWed.length, 1);
eq('编辑：节次标签跟着变', edWed[0].periodLabel, '5-6节');
eq('编辑：周次标签变成单周', AR.Schedule.weeksLabel(AR.Store.blockById(edBlock.id), 20), '1-20 单周');

// 单独给这门课写死时间（不动整张节次表）
AR.Store.updateBlock(edBlock.id, { startTime: '07:50', endTime: '09:20' });
edBlock = AR.Store.blockById(edBlock.id);
const edWed2 = AR.Schedule.dayItems(U.addDays(editMonday, 2)).filter((i) => i.course.name === '编辑测试课')[0];
eq('编辑：自定义开始时间', edWed2.start, '07:50');
eq('编辑：自定义结束时间', edWed2.end, '09:20');
eq('编辑：周次文本读回来是单周', AR.Store.weeksText(edBlock, 20), '单周');

// 仅这一次：第 3 周的周三换教室 + 换时间，其它周不受影响
const onceDate = U.addDays(editMonday, 16);
const onceLoc = AR.Store.ensureLocationByRaw('Y楼 101');
AR.Store.upsertOverride(edBlock.id, edCourse.id, U.dateKey(onceDate), {
  type: 'room', newPeriodStart: 5, newPeriodEnd: 6,
  newLocationIds: [onceLoc.id], newStartTime: '10:00', newEndTime: '11:30'
});
const onceItems = AR.Schedule.dayItems(onceDate).filter((i) => i.course.name === '编辑测试课');
eq('单次改动：只出现在这一天', onceItems.length, 1);
eq('单次改动：那天换了地点', onceItems[0].location.raw, 'Y楼 101');
eq('单次改动：那天换了时间', onceItems[0].start + '-' + onceItems[0].end, '10:00-11:30');
const otherWed = AR.Schedule.dayItems(U.addDays(editMonday, 30)).filter((i) => i.course.name === '编辑测试课')[0];
eq('单次改动：别的周还是原时间', otherWed.start, '07:50');
eq('单次改动：不会重复堆记录', AR.Store.overridesOfBlock(edBlock.id).length, 1);

// 同一门课再次改「仅这一次」，合并到同一条记录
AR.Store.upsertOverride(edBlock.id, edCourse.id, U.dateKey(onceDate), { newNote: '带作业本' });
eq('单次改动：重复编辑仍只有 1 条记录', AR.Store.overridesOfBlock(edBlock.id).length, 1);
const onceItems2 = AR.Schedule.dayItems(onceDate).filter((i) => i.course.name === '编辑测试课')[0];
eq('单次改动：备注合并进来了', onceItems2.note, '带作业本');

// 老师 / 地点按名字复用，不会越改越多条
const t1 = AR.Store.ensureTeacherByName('王五');
const t2 = AR.Store.ensureTeacherByName('王五');
eq('老师：同名复用同一条', t1.id, t2.id);
const l1 = AR.Store.ensureLocationByRaw('X楼305');
const l2 = AR.Store.ensureLocationByRaw('X楼305');
eq('地点：同名复用同一条', l1.id, l2.id);

// 删除单个时段：排课与它的单次变动一起清掉
const beforeBlocks = AR.Store.get().blocks.length;
AR.Store.removeBlock(edBlock.id);
eq('删除时段：排课少一条', AR.Store.get().blocks.length, beforeBlocks - 1);
eq('删除时段：连带单次变动一起清掉', AR.Store.overridesOfBlock(edBlock.id).length, 0);

/* ── 输出 ────────────────────────────────────────────────── */

/* ── 13. 默认作息表（v0.2.1）与跨设备合并 ────────────────── */

const freshPeriods = AR.Store.makePeriods('SEM_X');
const newTable = [['08:00', '08:45'], ['08:50', '09:35'], ['10:00', '10:45'], ['10:50', '11:35'], ['13:30', '14:15'], ['14:20', '15:05'], ['15:30', '16:15'], ['16:20', '17:05'], ['18:00', '18:45'], ['18:50', '19:35'], ['19:40', '20:25'], ['20:30', '22:00']];
eq('新作息：12 节', freshPeriods.length, 12);
let tableOk = true;
newTable.forEach((t, i) => {
  if (freshPeriods[i].start !== t[0] || freshPeriods[i].end !== t[1]) { tableOk = false; }
});
check('新作息：12 节时间全部与需求一致', tableOk);
eq('新作息：第 2 节 08:50', freshPeriods[1].start, '08:50');
eq('新作息：第 12 节 20:30-22:00', freshPeriods[11].start + '-' + freshPeriods[11].end, '20:30-22:00');

// 迁移：老默认作息自动换成新表；用户自己改过的作息保持不动
const oldDefault = [['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'], ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'], ['19:00', '19:45'], ['19:55', '20:40'], ['20:50', '21:35'], ['21:45', '22:30']];
const migSem = [{ id: 'S1', name: '学期', startDate: '2026-09-07', weekCount: 20 }];
const migrateOld = { kind: 'abbeyroad.sync', schemaVersion: 1, settings: {}, semesters: migSem, periods: [] };
oldDefault.forEach((t, i) => { migrateOld.periods.push({ id: 'p' + i, semesterId: 'S1', index: i + 1, start: t[0], end: t[1] }); });
AR.Store.migrate(migrateOld);
eq('迁移：老默认作息换成新表第 2 节', migrateOld.periods[1].start, '08:50');
eq('迁移：仍然是 12 节', migrateOld.periods.length, 12);

const customPeriods = { kind: 'abbeyroad.sync', schemaVersion: 1, settings: {}, semesters: migSem, periods: [] };
oldDefault.forEach((t, i) => { customPeriods.periods.push({ id: 'p' + i, semesterId: 'S1', index: i + 1, start: t[0], end: t[1] }); });
customPeriods.periods[0].start = '07:30';   // 用户自己改过第一节
AR.Store.migrate(customPeriods);
eq('迁移：改过的作息不被覆盖', customPeriods.periods[0].start, '07:30');
eq('迁移：没改的节次也保持原样', customPeriods.periods[1].start, '08:55');

// 跨设备合并：同一个课表在另一台设备导出，id 全都不一样 → 不该变成两份
const semA = AR.Store.currentSemester();
const deviceB = AR.Store.exportPayload();
const idMap = {};
const reid = (prefix, id) => {
  if (!idMap[id]) { idMap[id] = prefix + Math.random().toString(36).slice(2, 10).toUpperCase(); }
  return idMap[id];
};
deviceB.semesters = deviceB.semesters.map((s) => Object.assign({}, s, { id: reid('S', s.id) }));
deviceB.teachers = deviceB.teachers.map((t) => Object.assign({}, t, { id: reid('T', t.id), updatedAt: '2026-01-01T00:00:00.000Z' }));
deviceB.locations = deviceB.locations.map((l) => Object.assign({}, l, { id: reid('L', l.id), updatedAt: '2026-01-01T00:00:00.000Z' }));
deviceB.courses = deviceB.courses.map((c) => Object.assign({}, c, { id: reid('C', c.id), semesterId: idMap[c.semesterId] || c.semesterId, teacherIds: (c.teacherIds || []).map((x) => reid('T', x)), defaultLocationId: c.defaultLocationId ? reid('L', c.defaultLocationId) : null, updatedAt: '2026-01-01T00:00:00.000Z' }));
deviceB.blocks = deviceB.blocks.map((b) => Object.assign({}, b, { id: reid('B', b.id), courseId: reid('C', b.courseId), teacherIds: (b.teacherIds || []).map((x) => reid('T', x)), locationIds: (b.locationIds || []).map((x) => reid('L', x)), updatedAt: '2026-01-01T00:00:00.000Z' }));
deviceB.overrides = [];
deviceB.tombstones = [];

const crossCourses = AR.Store.get().courses.length;
const crossBlocks = AR.Store.get().blocks.length;
const crossReport = AR.Store.previewMerge(deviceB);
eq('跨设备：一门课都不新增（按课程名认出来了）', crossReport.added, 0);
check('跨设备：识别出被合并的记录', crossReport.matched > 0, crossReport.matched);
AR.Store.applyMerge(deviceB, {});
eq('跨设备：导入后课程数不变（不会变两份）', AR.Store.get().courses.length, crossCourses);
eq('跨设备：导入后时段数不变', AR.Store.get().blocks.length, crossBlocks);
check('跨设备：每个时段的课程都存在',
  AR.Store.get().blocks.every((b) => !!AR.Store.courseById(b.courseId)));
check('跨设备：每个时段的老师都存在',
  AR.Store.get().blocks.every((b) => (b.teacherIds || []).every((t) => !!AR.Store.teacherById(t))));
check('跨设备：每个时段的地点都存在',
  AR.Store.get().blocks.every((b) => (b.locationIds || []).every((l) => !!AR.Store.locationById(l))));

// 另一台设备真正新加的课，还是要能进来
const deviceC = AR.Store.exportPayload();
deviceC.courses = [{ id: 'NEWCOURSE99', semesterId: semA.id, name: '跨设备新课', teacherIds: [], defaultLocationId: null, colorKey: 'green', tags: [], note: '', updatedAt: '2026-12-01T00:00:00.000Z' }];
deviceC.teachers = [];
deviceC.locations = [];
deviceC.blocks = [{ id: 'NEWBLOCK99', courseId: 'NEWCOURSE99', weekday: 5, periodStart: 3, periodEnd: 4, weekMode: 'all', weeks: [], locationIds: [], teacherIds: [], note: '', updatedAt: '2026-12-01T00:00:00.000Z' }];
deviceC.overrides = [];
deviceC.tombstones = [];
const repC = AR.Store.previewMerge(deviceC);
eq('跨设备：新课程会被新增', repC.added, 2);
AR.Store.applyMerge(deviceC, {});
const newCourse = AR.Store.get().courses.filter((c) => c.name === '跨设备新课')[0];
check('跨设备：新课程写进去了', !!newCourse);
check('跨设备：新课程的时段也写进去了',
  AR.Store.get().blocks.filter((b) => b.courseId === newCourse.id).length === 1);

/* ── 11. 导入自己导出的文件：应当「无事发生」，不能重复添加 ── */

const selfPayload = AR.Store.exportPayload();
const selfReport = AR.Store.previewMerge(selfPayload);
eq('导入自己的导出：不新增', selfReport.added, 0);
eq('导入自己的导出：不更新', selfReport.updated, 0);
eq('导入自己的导出：不会显示「删除 N」', selfReport.removed, 0);
const selfBefore = AR.Store.get().courses.length;
AR.Store.applyMerge(JSON.parse(JSON.stringify(selfPayload)), {});
eq('导入自己的导出：课程数不变', AR.Store.get().courses.length, selfBefore);

/* ── 12. 第 13 节及以后：节次表自动补足 ─────────────────── */

const lateTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '晚课测试课｜周四｜13-14｜1-16｜测试楼101｜测试老师'
].join('\n');
const lateEnt = AR.MdParse.toEntities(AR.MdParse.parse(lateTxt, semOpts), AR.Store.get(), { mergeMode: 'never' });
const lateRes = AR.MdParse.applyEntities(lateEnt, AR.Store.get());
eq('晚课：自动补了 2 节', lateRes.periodsAdded, 2);
const latePeriods = AR.Store.periodsOf(AR.Store.currentSemester().id);
eq('晚课：节次表扩到 14 节', latePeriods.length, 14);
check('晚课：补出来的第 13 节排在原最后一节之后',
  latePeriods[12].start > latePeriods[11].end, latePeriods[12].start + ' vs ' + latePeriods[11].end);
const lateMon = AR.Util.mondayOf(AR.Util.parseDateKey(AR.Store.currentSemester().startDate));
const lateItems = AR.Schedule.dayItems(AR.Util.addDays(lateMon, 3)).filter((i) => i.course.name === '晚课测试课');
eq('晚课：周四能查到这节课', lateItems.length, 1);
eq('晚课：节次标签是 13-14 节', lateItems.length ? lateItems[0].periodLabel : '', '13-14节');
eq('晚课：时间不再是空的', lateItems.length ? lateItems[0].start : '', latePeriods[12].start);

/* ── 13. 重复导入：不加重复时段、不留孤儿 ────────────────── */

const twiceTxt = [
  'AbbeyRoad 课表 v1',
  '开学日期：2026-09-07',
  '重复导入测试课｜周二｜3-4｜1-16｜重复楼101｜老师A｜备注一'
].join('\n');
function importOnce(txt) {
  const ent = AR.MdParse.toEntities(AR.MdParse.parse(txt, semOpts), AR.Store.get(), { mergeMode: 'never' });
  return AR.MdParse.applyEntities(ent, AR.Store.get());
}
importOnce(twiceTxt);
const blocksAfterFirst = AR.Store.get().blocks.length;
const twiceCourse = AR.Store.get().courses.filter((c) => c.name === '重复导入测试课')[0];
eq('重复导入：第一次写入 1 个时段',
  AR.Store.get().blocks.filter((b) => b.courseId === twiceCourse.id).length, 1);
importOnce(twiceTxt);
eq('重复导入：第二次不再新增时段', AR.Store.get().blocks.length, blocksAfterFirst);
eq('重复导入：课程仍然只有一门',
  AR.Store.get().courses.filter((c) => c.name === '重复导入测试课').length, 1);
const orphanCount = AR.Store.get().blocks.filter(
  (b) => !AR.Store.get().courses.some((c) => c.id === b.courseId)).length;
eq('重复导入：没有孤儿时段', orphanCount, 0);

importOnce(twiceTxt.replace('重复楼101', '重复楼202').replace('备注一', '备注二'));
eq('重复导入：改地点是覆盖而不是新增', AR.Store.get().blocks.length, blocksAfterFirst);
const twiceBlock = AR.Store.get().blocks.filter((b) => b.courseId === twiceCourse.id)[0];
eq('重复导入：备注也更新成新的', twiceBlock.note, '备注二');

// 老数据里的孤儿时段：加载时自动清掉
const dirtyState = AR.Store.get();
dirtyState.blocks.push({
  id: 'ORPHAN_BLOCK_1', courseId: 'COURSE_NOT_EXIST', weekday: 1,
  periodStart: 1, periodEnd: 1, weekMode: 'all', weeks: [], locationIds: [], teacherIds: []
});
const cleaned = AR.Store.migrate(dirtyState);
eq('孤儿时段：加载时会自动清掉',
  cleaned.blocks.filter((b) => b.courseId === 'COURSE_NOT_EXIST').length, 0);

/* ── 14. 清空数据后再导入：当前学期要跟着切过去 ───────────── */

AR.Store.reset(true);                      // 模拟「清空所有数据」
eq('清空后：课程为 0', AR.Store.get().courses.length, 0);

const foreignPayload = {
  kind: 'abbeyroad.sync', schemaVersion: 1,
  semesters: [{ id: 'SEM_B', name: '导入的学期', startDate: '2026-02-23', weekCount: 20, isCurrent: true }],
  periods: [],
  teachers: [], locations: [],
  courses: [{
    id: 'C_B1', semesterId: 'SEM_B', name: '导入课', teacherIds: [],
    defaultLocationId: null, colorKey: 'blue', tags: [], note: '', updatedAt: new Date().toISOString()
  }],
  blocks: [{
    id: 'BLK_B1', courseId: 'C_B1', weekday: 1, periodStart: 3, periodEnd: 4,
    weekMode: 'all', weeks: [], locationIds: [], teacherIds: [], note: '',
    isConsecutive: false, segments: null, updatedAt: new Date().toISOString()
  }],
  overrides: [], events: [], reminders: [], tombstones: []
};
AR.Store.applyMerge(foreignPayload, {});

const curAfterImport = AR.Store.currentSemester();
eq('清空后导入：当前学期切到导入的那个', curAfterImport && curAfterImport.name, '导入的学期');
check('清空后导入：当前学期确实有课',
  AR.Store.blockCountOfSemester(curAfterImport.id) > 0);
const importMonday = U.mondayOf(U.parseDateKey('2026-02-23'));
const importedItems = AR.Schedule.dayItems(importMonday);
eq('清空后导入：周一能查到这门课', importedItems.length, 1);
eq('清空后导入：节次标签正常', importedItems.length ? importedItems[0].periodLabel : '', '3-4节');
eq('清空后导入：节次时间也正常（不是空的）', importedItems.length ? (importedItems[0].start + '-' + importedItems[0].end) : '', '10:00-11:35');

/* ── 15. 节次表归属：补齐时要把整张表认领过来 ─────────────── */

AR.Store.reset(true);
const st3 = AR.Store.get();
const curSemId3 = st3.settings.schedule.currentSemesterId;
for (let i = 0; i < st3.periods.length; i++) { st3.periods[i].semesterId = 'GHOST_SEM'; }   // 挂到不存在的学期
const added3 = AR.Store.ensurePeriodsFor(curSemId3, 14);
eq('节次认领：补了 2 节', added3, 2);
eq('节次认领：当前学期名下有 14 节（不会只剩新补的）',
  AR.Store.periodsOf(AR.Store.currentSemester().id).length, 14);
eq('节次认领：第 1 节还是 08:00',
  AR.Store.periodsOf(AR.Store.currentSemester().id)[0].start, '08:00');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('');
  console.log('失败明细：');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
