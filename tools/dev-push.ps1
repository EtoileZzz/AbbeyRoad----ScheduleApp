# 开发用：把 app/ 里的界面资源推进 Windows 端已解压的 web 目录，并让 WebView2 重新加载。
# 这样改一行 CSS/JS 不用重编 EXE，几秒钟就能看到效果（交付前仍然要跑 build.ps1 重新打包）。
param([string]$Version = '0.2.4', [switch]$NoReload)

$ErrorActionPreference = 'Stop'
$projRoot = Split-Path $PSScriptRoot -Parent
$src = Join-Path $projRoot 'app'
$dst = Join-Path $env:LOCALAPPDATA ("Abbey Road\web\v" + $Version)

if (-not (Test-Path $dst)) { throw "目标目录不存在：$dst（先用新版 EXE 启动一次即可生成）" }

Copy-Item (Join-Path $src 'index.html') $dst -Force
foreach ($sub in @('css', 'js')) {
    $to = Join-Path $dst $sub
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    Copy-Item (Join-Path $src "$sub\*") $to -Force
}
Write-Host "已推送 → $dst"

if (-not $NoReload) {
    $env:CDP_PORT = '9223'
    node (Join-Path $PSScriptRoot 'cdp.js') "location.reload(); 'reloading'" | Out-Null
    Start-Sleep -Milliseconds 1200
    Write-Host '已触发重新加载'
}
