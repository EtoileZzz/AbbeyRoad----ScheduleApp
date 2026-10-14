/**
 * 推送工具：本机 github.com:443 不通，git push 用不了 → 走 api.github.com 的 Git Data API。
 *
 * 做四件事：
 *   1. 读 dist/_gh_push_meta.json（由 pwsh 预先用 git 生成），逐个上传跟踪文件为 blob
 *   2. 建 tree + commit（作者信息与本地提交一致）
 *   3. 把指定分支指向这个提交（默认只推 release）
 *   4. 打 tag v<版本> 并创建 Release，上传三件套资产
 *
 * 用法：
 *   node tools/gh-api-push.js push
 *   node tools/gh-api-push.js release <tag> <说明文件路径> <资产1> [资产2 ...]
 *
 * 为什么 git 信息要从文件读、而不是自己 spawn git：
 *   本机沙箱禁止 node 通过管道 spawn 子进程（EPERM），`execFileSync('git', ...)` 必失败。
 *
 * 凭据：环境变量 GH_TOKEN（由 `gh auth token` 注入，不落盘、不进日志）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = 'EtoileZzz/AbbeyRoad----ScheduleApp';
const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN;
const projRoot = path.resolve(__dirname, '..');
const distDir = path.join(projRoot, 'dist');
/**
 * git 仓库根 = 源码目录的上一层（本布局：ARProject/.git，源码在 ARProject/abbey-road/）。
 * 元数据里的 file.path 是相对 git 根的，读文件必须用这个基准，不能用 projRoot。
 */
const gitRoot = path.resolve(projRoot, '..');

if (!TOKEN) { throw new Error('缺少 GH_TOKEN（先执行 gh auth token 注入环境变量）'); }

const headers = {
  'Authorization': 'Bearer ' + TOKEN,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'abbeyroad-release'
};

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { }
  if (!res.ok) {
    const msg = json && json.message ? json.message : text.slice(0, 300);
    throw new Error(`${method} ${url} -> ${res.status} ${msg}`);
  }
  return json;
}

/** 读取由 pwsh 预先生成的 git 元数据 */
function readMeta() {
  const f = path.join(distDir, '_gh_push_meta.json');
  if (!fs.existsSync(f)) {
    throw new Error('缺少 dist/_gh_push_meta.json —— 先由 pwsh 生成（git 信息 + 文件清单）');
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

async function push() {
  const meta = readMeta();
  console.log('本地提交  : ' + meta.commit.slice(0, 8) + '  ' + meta.subject);
  console.log('作者      : ' + meta.author + ' <' + meta.email + '>  ' + meta.date);
  console.log('跟踪文件  : ' + meta.files.length + ' 个');

  // 1) 逐个上传 blob
  const tree = [];
  let i = 0;
  for (const f of meta.files) {
    i++;
    const buf = fs.readFileSync(path.join(gitRoot, f.path));
    const b = await api('POST', `/repos/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64'
    });
    tree.push({ path: f.path, mode: f.mode, type: 'blob', sha: b.sha });
    if (i % 25 === 0 || i === meta.files.length) { console.log('  blob ' + i + '/' + meta.files.length); }
  }

  // 2) tree
  const treeRes = await api('POST', `/repos/${REPO}/git/trees`, { tree });
  console.log('tree      : ' + treeRes.sha.slice(0, 8) + '（' + tree.length + ' 条目）');

  // 3) commit（不带 parent —— 新仓库的起点提交）
  const newCommit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: meta.message,
    tree: treeRes.sha,
    author: { name: meta.author, email: meta.email, date: meta.date },
    committer: { name: meta.author, email: meta.email, date: meta.date }
  });
  console.log('commit    : ' + newCommit.sha.slice(0, 8));

  // 4) 分支：默认只推 release（既有约定：main 没被明确要求就不推）
  const branches = (process.env.GH_BRANCHES || 'release').split(',').map((s) => s.trim()).filter(Boolean);
  for (const br of branches) {
    try {
      await api('PATCH', `/repos/${REPO}/git/refs/heads/${br}`, { sha: newCommit.sha, force: true });
      console.log('  ref ' + br + ' 已更新 -> ' + newCommit.sha.slice(0, 8));
    } catch (e) {
      await api('POST', `/repos/${REPO}/git/refs`, { ref: 'refs/heads/' + br, sha: newCommit.sha });
      console.log('  ref ' + br + ' 已创建 -> ' + newCommit.sha.slice(0, 8));
    }
  }
  fs.writeFileSync(path.join(distDir, '_gh_pushed_sha.txt'), newCommit.sha, 'utf8');
  console.log('\n远端提交  : ' + newCommit.sha);
  return newCommit.sha;
}

/**
 * 上传 Release 资产。
 *
 * ⚠ 不能用 `new FormData()` + fetch：实测 undici 会把 multipart **信封**本身
 * 当成文件内容上传（GitHub 收到的是 `------formdata-undici-...` 开头的东西，
 * PK/MZ 头全丢，APK 直接变成"not a ZIP archive"）。所以这里手工拼 multipart 字节。
 * 本机 curl.exe 也不可用（schannel SEC_E_NO_CREDENTIALS，与 git 失败同源），
 * 只能靠 node 的 fetch。
 */
async function uploadAsset(uploadUrl, file, tag) {
  const name = path.basename(file);
  const buf = fs.readFileSync(file);
  const B = '----abbeyroad' + Date.now().toString(16) + Math.floor(Math.random() * 1e6).toString(16);

  const CRLF = Buffer.from('\r\n');
  const preamble = Buffer.from(
    '--' + B + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + name + '"\r\n'
    + 'Content-Type: application/octet-stream\r\n\r\n', 'utf8');
  const epilogue = Buffer.from('\r\n--' + B + '--\r\n', 'utf8');
  const body = Buffer.concat([preamble, buf, epilogue]);

  const url = uploadUrl.replace('{?name,label}', '') + '?name=' + encodeURIComponent(name);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'abbeyroad-release',
      'Content-Type': 'multipart/form-data; boundary=' + B,
      'Content-Length': String(body.length)
    },
    body: body
  });
  const txt = await res.text();
  if (!res.ok) { throw new Error('上传资产失败 ' + name + ' -> ' + res.status + ' ' + txt.slice(0, 300)); }
  const j = JSON.parse(txt);
  console.log('  资产已上传：' + j.name + '  ' + j.size + ' 字节'
    + (j.size === buf.length ? '  (与本地同尺寸 OK)' : '  !! 尺寸不符，本地 ' + buf.length));
  return j;
}

async function release(tag, notesFile, assets) {
  const sha = process.env.GH_SHA || fs.readFileSync(path.join(projRoot, 'dist', '_gh_pushed_sha.txt'), 'utf8').trim();
  const notes = fs.readFileSync(notesFile, 'utf8');

  // tag（存在就更新指向）
  try {
    await api('PATCH', `/repos/${REPO}/git/refs/tags/${tag}`, { sha, force: true });
    console.log('tag ' + tag + ' 已更新 -> ' + sha.slice(0, 8));
  } catch (e) {
    await api('POST', `/repos/${REPO}/git/refs`, { ref: 'refs/tags/' + tag, sha });
    console.log('tag ' + tag + ' 已创建 -> ' + sha.slice(0, 8));
  }

  // Release（已存在就先删掉再建，保证资产是最新的三件套）
  try {
    await api('GET', `/repos/${REPO}/releases/tags/${tag}`);
    console.log('已存在同名 Release，先删除');
    await api('DELETE', `/repos/${REPO}/releases/tags/${tag}`);
  } catch (e) { /* 不存在就继续 */ }

  const rel = await api('POST', `/repos/${REPO}/releases`, {
    tag_name: tag,
    name: tag,
    body: notes,
    draft: false,
    prerelease: false
  });
  console.log('Release 已创建：' + rel.html_url);

  for (const a of assets) { await uploadAsset(rel.upload_url, a, tag); }
  console.log('\n完成：' + rel.html_url);
}

const cmd = process.argv[2];
(async () => {
  if (cmd === 'push') {
    await push();
  } else if (cmd === 'release') {
    const tag = process.argv[3];
    const notes = process.argv[4];
    const assets = process.argv.slice(5);
    if (!tag || !notes || !assets.length) { throw new Error('用法：release <tag> <说明文件> <资产...>'); }
    await release(tag, notes, assets);
  } else {
    throw new Error('用法：node tools/gh-api-push.js push | release <tag> <说明文件> <资产...>');
  }
})().catch((e) => { console.error('失败：' + (e && e.message ? e.message : e)); process.exitCode = 1; });
