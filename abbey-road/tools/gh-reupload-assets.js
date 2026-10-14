/**
 * 只重传 Release 资产（不动分支/tag/Release 本体）。
 *
 * 背景：先用 `new FormData()` 上传，undici 把 multipart 信封当成文件内容，
 * 三个资产全坏（APK 变成 "not a ZIP archive"）。本文件配套修好的
 * gh-api-push.js 里的 uploadAsset()（手工拼 multipart）做重传。
 *
 * 用法：GH_TOKEN=xxx node tools/gh-reupload-assets.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = 'EtoileZzz/AbbeyRoad----ScheduleApp';
const TAG = 'v0.4.1a';
const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { throw new Error('缺少 GH_TOKEN'); }

const projRoot = path.resolve(__dirname, '..');
const wsRoot = path.resolve(projRoot, '..');

const headers = {
  'Authorization': 'Bearer ' + TOKEN,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'abbeyroad-release'
};

async function api(method, url, body) {
  const res = await fetch(API + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { }
  if (!res.ok) { throw new Error(method + ' ' + url + ' -> ' + res.status + ' ' + (j && j.message || txt.slice(0, 200))); }
  return j;
}

async function upload(uploadUrl, file) {
  const name = path.basename(file);
  const buf = fs.readFileSync(file);
  const B = '----abbeyroad' + Date.now().toString(16) + Math.floor(Math.random() * 1e6).toString(16);
  const preamble = Buffer.from(
    '--' + B + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + name + '"\r\n'
    + 'Content-Type: application/octet-stream\r\n\r\n', 'utf8');
  const epilogue = Buffer.from('\r\n--' + B + '--\r\n', 'utf8');
  const body = Buffer.concat([preamble, buf, epilogue]);

  const url = uploadUrl.replace('{?name,label}', '') + '?name=' + encodeURIComponent(name);
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({}, headers, {
      'Content-Type': 'multipart/form-data; boundary=' + B,
      'Content-Length': String(body.length)
    }),
    body
  });
  const txt = await res.text();
  if (!res.ok) { throw new Error('上传失败 ' + name + ' -> ' + res.status + ' ' + txt.slice(0, 300)); }
  const j = JSON.parse(txt);
  console.log('  ' + j.name + '  ' + j.size + ' 字节  (本地 ' + buf.length + ')  '
    + (j.size === buf.length ? '尺寸一致 OK' : '!! 尺寸不符'));
  return j;
}

(async () => {
  const rel = await api('GET', `/repos/${REPO}/releases/tags/${TAG}`);
  console.log('Release ' + TAG + '  id=' + rel.id + '  现有资产 ' + rel.assets.length + ' 个');

  const files = [
    path.join(wsRoot, 'AbbeyRoad-v0.4.1a.apk'),
    path.join(wsRoot, 'AbbeyRoad-Setup-v0.4.1a.exe'),
    path.join(wsRoot, 'AbbeyRoad-v0.4.1a-src.zip')
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) { throw new Error('缺少本地文件：' + f); }
  }

  // 同名资产先删掉，否则 422
  for (const a of rel.assets) {
    console.log('  删除旧资产 ' + a.name + ' (id=' + a.id + ')');
    await api('DELETE', `/repos/${REPO}/releases/assets/${a.id}`);
  }

  console.log('开始重传（手工 multipart）：');
  for (const f of files) { await upload(rel.upload_url, f); }

  const after = await api('GET', `/repos/${REPO}/releases/tags/${TAG}`);
  console.log('\n最终资产清单：');
  for (const a of after.assets) { console.log('  ' + a.name + '  ' + a.size + ' 字节'); }
  console.log('\n页面：' + after.html_url);
})().catch((e) => { console.error('失败：' + (e && e.message ? e.message : e)); process.exitCode = 1; });
