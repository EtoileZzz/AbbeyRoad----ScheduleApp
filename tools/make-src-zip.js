/**
 * 打包「可开源」的源码目录：只挑源码 / 文档 / 截图，剔除构建产物、签名与本地私有配置。
 *
 * 用法：node tools/make-src-zip.js
 * 产出：<临时目录>/abbey-road-src-<时间戳>/abbey-road/…（再由 build-src-zip.ps1 压缩）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const projRoot = path.resolve(__dirname, '..');
const stageRoot = path.join(os.tmpdir(), 'abbeyroad-src-' + Date.now().toString(36));
const target = path.join(stageRoot, 'abbey-road');

// 顶层要带上的目录 / 文件
const includeDirs = ['app', 'android', 'windows', 'tools', 'docs'];
const includeFiles = ['README.md', 'CHANGELOG.md', 'LICENSE', '.gitignore'];

// 目录内要剔除的：构建产物、私有配置、签名
const skipDirNames = new Set(['build', 'dist', 'node_modules', '.vs', '.git', '__pycache__', 'obj']);
const skipFileNames = new Set(['build.local.ps1']);
const skipFileExt = new Set(['.keystore', '.jks', '.idsig', '.log']);

/** 会泄露本机信息的字符串（打包前必须为 0） */
const privatePatterns = [/abbeyroad123/, /C:\\Users\\Etoile/];

/** 自身带这些模式串，扫描时跳过自己 */
const selfFile = 'tools/make-src-zip.js';

let copied = 0;
const leaks = [];

function shouldSkip(name, parentDir) {
  if (skipDirNames.has(name)) { return true; }
  // android/assets 是构建脚本从 app/ 复制出来的副本，不进源码包
  if (name === 'assets' && /[\\/]android$/.test(parentDir || '')) { return true; }
  if (skipFileNames.has(name)) { return true; }
  return skipFileExt.has(path.extname(name).toLowerCase());
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
  const rel = path.relative(projRoot, from).replace(/\\/g, '/');
  if (rel === selfFile) { return; }
  const ext = path.extname(from).toLowerCase();
  if (['.ps1', '.js', '.cs', '.java', '.md', '.txt', '.xml', '.html', '.css', '.json'].indexOf(ext) >= 0) {
    const text = fs.readFileSync(from, 'utf8');
    for (const re of privatePatterns) {
      if (re.test(text)) { leaks.push(rel + ' → ' + re); }
    }
  }
}

function walk(fromDir, toDir) {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    if (shouldSkip(entry.name, fromDir)) { continue; }
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) { walk(from, to); }
    else if (entry.isFile()) { copyFile(from, to); }
  }
}

fs.mkdirSync(target, { recursive: true });
for (const d of includeDirs) {
  const from = path.join(projRoot, d);
  if (fs.existsSync(from)) { walk(from, path.join(target, d)); }
}
for (const f of includeFiles) {
  const from = path.join(projRoot, f);
  if (fs.existsSync(from)) { copyFile(from, path.join(target, f)); }
}

console.log('源码暂存目录：' + target);
console.log('已复制文件数：' + copied);
if (leaks.length) {
  console.log('!! 发现疑似私人信息，请处理后重跑：');
  for (const l of leaks) { console.log('   - ' + l); }
  process.exit(1);
}
console.log('未发现私人路径 / 口令 ✅');
console.log('STAGE=' + stageRoot);
