/**
 * 开发用：一处改版本号（app / Android / Windows 全套）。
 * 用法：node tools/bump-version.js 0.2.5 16
 *       node tools/bump-version.js 0.3.2a 24      ← 小修订用尾字母（a、b、c…）
 *       第二个参数是 Android versionCode（必须比上一版大）。
 * 注意：AndroidManifest.xml 绝对不能写 BOM，PS1 必须是 UTF-8 BOM，
 *       所以这里按文件分别处理编码。
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const next = process.argv[2];
const code = process.argv[3];
if (!/^\d+\.\d+\.\d+[a-z]?$/.test(next || '')) { throw new Error('用法：node tools/bump-version.js 0.2.5 16（小修订可写 0.3.2a）'); }
if (!/^\d+$/.test(code || '')) { throw new Error('缺少 Android versionCode'); }

function read(p) {
  const buf = fs.readFileSync(p);
  const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  return { text: buf.toString('utf8').replace(/^\uFEFF/, ''), bom };
}
function write(p, text, bom) {
  fs.writeFileSync(p, Buffer.concat([bom ? Buffer.from([0xEF, 0xBB, 0xBF]) : Buffer.alloc(0),
    Buffer.from(text, 'utf8')]));
}
function swap(rel, pairs) {
  const p = path.join(root, rel);
  const f = read(p);
  for (const [from, to] of pairs) {
    if (f.text.indexOf(from) < 0) { throw new Error('没找到片段：' + from + ' @ ' + rel); }
    f.text = f.text.split(from).join(to);
  }
  write(p, f.text, f.bom);
  console.log('已更新 ' + rel);
}

/** 正则替换（找不到就报错），保持原有编码 */
function swapRe(rel, re, to) {
  const p = path.join(root, rel);
  const f = read(p);
  if (!re.test(f.text)) { throw new Error('正则没匹配上：' + re + ' @ ' + rel); }
  f.text = f.text.replace(re, to);
  write(p, f.text, f.bom);
  console.log('已更新 ' + rel);
}

const cur = read(path.join(root, 'app/js/core.js')).text.match(/APP_VERSION = '([\d.a-z]+)'/)[1];
swapRe('app/js/core.js', /APP_VERSION = '[\d.a-z]+'/, "APP_VERSION = '" + next + "'");
swapRe('android/AndroidManifest.xml', /android:versionCode="\d+"/, 'android:versionCode="' + code + '"');
swapRe('android/AndroidManifest.xml', /android:versionName="[\d.a-z]+"/, 'android:versionName="' + next + '"');
swapRe('android/build.ps1', /\$version   = '[\d.a-z]+'/, "$version   = '" + next + "'");
swapRe('android/build.ps1', /--version-code \d+/, '--version-code ' + code);
swapRe('windows/src/AppPaths.cs', /Version = "[\d.a-z]+"/, 'Version = "' + next + '"');
swapRe('windows/build.ps1', /\$version   = '[\d.a-z]+'/, "$version   = '" + next + "'");
swapRe('windows/README.txt', /v[\d.a-z]+/, 'v' + next);
swapRe('windows/installer/Installer.cs', /private const string Version = "[\d.a-z]+"/, 'private const string Version = "' + next + '"');
swapRe('windows/installer/Installer.cs', /版本 " \+ "[\d.a-z]+"/, '版本 " + "' + next + '"');
console.log('版本已更新到 ' + next + '（Android versionCode ' + code + '）');
