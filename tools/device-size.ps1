# 开发用：用 adb 把模拟器临时改成别的屏幕尺寸 / 密度，验证多种屏幕比例与 PPI。
# 用法：
#   powershell -File tools/device-size.ps1 -Preset phone-small
#   powershell -File tools/device-size.ps1 -Size 1768x2208 -Density 400 -Out dist\shot.png
#   powershell -File tools/device-size.ps1 -Reset
param(
    [string]$Preset = '',
    [string]$Size = '',
    [int]$Density = 0,
    [string]$Out = '',
    [string]$Shot = '',
    [switch]$Reset,
    [int]$WaitMs = 2500
)

$ErrorActionPreference = 'Stop'
$adb = if ($env:ADB) { $env:ADB } else { Join-Path $HOME '.android-build\sdk\platform-tools\adb.exe' }
if (-not (Test-Path $adb)) { throw "找不到 adb：$adb" }

$presets = @{
    'phone'          = @{ size = '900x2000';  density = 225; note = '直板机 640x1422dp' }
    'phone-small'    = @{ size = '720x1280';  density = 320; note = '小屏直板 360x640dp' }
    'phone-narrow'   = @{ size = '1080x2400'; density = 420; note = '窄长直板 411x914dp' }
    'fold-closed'    = @{ size = '832x2208';  density = 400; note = '折叠屏外屏 333x883dp' }
    'fold-open'      = @{ size = '1768x2208'; density = 400; note = '折叠屏展开 707x883dp' }
    'tablet'         = @{ size = '1600x2560'; density = 320; note = '平板竖屏 800x1280dp' }
    'tablet-land'    = @{ size = '2560x1600'; density = 320; note = '平板横屏 1280x800dp' }
}

if ($Reset) {
    & $adb shell wm size reset | Out-Null
    & $adb shell wm density reset | Out-Null
    Start-Sleep -Milliseconds $WaitMs
    Write-Host '已恢复模拟器原始屏幕尺寸与密度'
    & $adb shell wm size
    & $adb shell wm density
    return
}

if ($Shot) {
    $remote = '/sdcard/abbeyroad-shot.png'
    & $adb shell screencap -p $remote | Out-Null
    $dir = Split-Path $Shot -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    & $adb pull $remote $Shot | Out-Null
    & $adb shell rm -f $remote | Out-Null
    Write-Host ('截图已保存：' + $Shot)
    return
}

if ($Preset) {
    if (-not $presets.ContainsKey($Preset)) {
        throw ('未知预设：' + $Preset + '；可用：' + (($presets.Keys | Sort-Object) -join ', '))
    }
    $Size = $presets[$Preset].size
    $Density = $presets[$Preset].density
    Write-Host ('预设 ' + $Preset + '（' + $presets[$Preset].note + '）→ ' + $Size + ' @ ' + $Density + 'dpi')
}
if (-not $Size) { throw '需要 -Preset 或 -Size' }

& $adb shell wm size $Size | Out-Null
if ($Density -gt 0) { & $adb shell wm density $Density | Out-Null }
Start-Sleep -Milliseconds $WaitMs

if ($Out) {
    $remote = '/sdcard/abbeyroad-shot.png'
    & $adb shell screencap -p $remote | Out-Null
    $dir = Split-Path $Out -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    & $adb pull $remote $Out | Out-Null
    & $adb shell rm -f $remote | Out-Null
    Write-Host ('截图已保存：' + $Out)
}

& $adb shell wm size
& $adb shell wm density
