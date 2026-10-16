# 开发用：把模拟器 / 真机的 WebView 调试端口转发到本机 9222（自动按进程号取 socket）
# adb 路径：优先 -Adb 参数 → $env:ADB → $HOME\.android-build 下的 SDK → PATH 里的 adb
param([string]$Adb = '')

$ErrorActionPreference = 'Stop'
$pkg = 'com.ganxing.abbeyroad'

if (-not $Adb) {
    if ($env:ADB) { $Adb = $env:ADB }
    else {
        $guess = Join-Path $HOME '.android-build\sdk\platform-tools\adb.exe'
        $Adb = if (Test-Path $guess) { $guess } else { 'adb' }
    }
}

$pidText = (& $Adb shell pidof $pkg 2>&1 | Out-String).Trim()
if (-not $pidText) {
    Write-Host '应用没在运行，先启动…'
    & $Adb shell am start -n "$pkg/.MainActivity" | Out-Null
    Start-Sleep -Seconds 6
    $pidText = (& $Adb shell pidof $pkg 2>&1 | Out-String).Trim()
}
if (-not $pidText) { throw '拿不到应用进程号' }

$sock = "webview_devtools_remote_$pidText"
& $Adb forward --remove-all | Out-Null
& $Adb forward tcp:9222 localabstract:$sock | Out-Null
Write-Host "已连接：pid=$pidText  socket=$sock  → 127.0.0.1:9222"
