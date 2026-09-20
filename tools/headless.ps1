# 开发用：在无法启动 WebView2 的环境里（CI / 无桌面会话 / Session 0）用无头 Edge 跑同一套界面，
# 方便用 CDP 截图与量帧。界面资源和打包进 EXE 的完全一致，都是 app/ 目录。
#
# 用法：
#   powershell -File tools/headless.ps1                    # 起服务 + 无头 Edge（CDP 9333）
#   powershell -File tools/headless.ps1 -Stop              # 关掉这两个进程
param(
    [int]$Port = 8123,
    [int]$CdpPort = 9333,
    [int]$Width = 1304,
    [int]$Height = 821,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$projRoot = Split-Path $PSScriptRoot -Parent
$profileDir = Join-Path $env:TEMP 'abbeyroad-headless'
$edge = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($Stop) {
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" |
        Where-Object { $_.CommandLine -like "*abbeyroad-headless*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like "*tools/serve.js*" -or $_.CommandLine -like "*tools\serve.js*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host '已停止无头浏览器与静态服务'
    return
}

if (-not $edge) { throw '找不到 Edge / Chrome，无法无头验证' }

$serving = $false
try {
    $r = Invoke-WebRequest ("http://127.0.0.1:" + $Port + '/index.html') -UseBasicParsing -TimeoutSec 3
    $serving = ($r.StatusCode -eq 200)
} catch { $serving = $false }
if (-not $serving) {
    Start-Process -WindowStyle Hidden -FilePath 'node.exe' `
        -ArgumentList @((Join-Path 'tools' 'serve.js'), $Port) -WorkingDirectory $projRoot
    Start-Sleep -Seconds 2
    Write-Host ("静态服务已启动：http://127.0.0.1:" + $Port + '/')
} else {
    Write-Host ('静态服务已在运行：http://127.0.0.1:' + $Port + '/')
}

Start-Process -WindowStyle Hidden -FilePath $edge -ArgumentList @(
    '--headless=new',
    ('--remote-debugging-port=' + $CdpPort),
    '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    ('--window-size=' + $Width + ',' + $Height),
    ('--user-data-dir=' + $profileDir),
    ('--app=http://127.0.0.1:' + $Port + '/index.html')
)
Start-Sleep -Seconds 4
try {
    $target = Invoke-WebRequest ('http://127.0.0.1:' + $CdpPort + '/json') -UseBasicParsing -TimeoutSec 6
    Write-Host ('无头浏览器就绪，CDP ' + $CdpPort + '：' + $target.Content.Substring(0, [Math]::Min(160, $target.Content.Length)))
    Write-Host ('之后统一用 $env:CDP_PORT=' + $CdpPort + ' 跑 tools/morph-shots.js、tools/smoke-ui.js 等脚本。')
} catch {
    # 起不来时做一次冒烟探针，把 stderr 打出来定位原因（无桌面会话下 Edge 可能直接退出）
    Write-Host 'CDP 没有起来，运行一次 --dump-dom 探针：'
    $outFile = Join-Path $env:TEMP 'abbeyroad-edge-out.txt'
    $errFile = Join-Path $env:TEMP 'abbeyroad-edge-err.txt'
    $p = Start-Process -FilePath $edge -Wait -PassThru -WindowStyle Hidden `
        -ArgumentList @('--headless=new', '--disable-gpu', '--no-sandbox',
            ('--user-data-dir=' + (Join-Path env: abbeyroad-probe)),
            '--dump-dom', ('http://127.0.0.1:' + $Port + '/index.html')) `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    Write-Host ('  退出码：' + $p.ExitCode)
    if (Test-Path $errFile) { Get-Content $errFile -TotalCount 8 | ForEach-Object { Write-Host ('  stderr: ' + $_) } }
    if (Test-Path $outFile) { Get-Content $outFile -TotalCount 3 | ForEach-Object { Write-Host ('  dom: ' + $_) } }
    throw '无头浏览器不可用：这个环境（通常是 Session 0 / 无桌面会话）里请改用真机或模拟器验证。'
}
