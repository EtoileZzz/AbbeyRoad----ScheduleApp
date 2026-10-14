<#
  只截取指定进程的主窗口（PrintWindow），不会截到桌面上的其它内容。
  用法：powershell -File capture-window.ps1 -ProcessName AbbeyRoad -Out dist\win-shot.png
#>
param(
  [string]$ProcessName = 'AbbeyRoad',
  [string]$Out = 'dist\win-shot.png',
  [int]$WaitMs = 4000
)

Add-Type -AssemblyName System.Drawing
if (-not ('WinCapNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinCapNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
}

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "找不到带窗口的进程：$ProcessName"; exit 1 }

[void][WinCapNative]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds $WaitMs

$rect = New-Object WinCapNative+RECT
[void][WinCapNative]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error '窗口尺寸无效'; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WinCapNative]::PrintWindow($proc.MainWindowHandle, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$outPath = Join-Path (Resolve-Path -LiteralPath (Split-Path $Out -Parent)).Path (Split-Path $Out -Leaf)
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved " + $outPath + " ok=" + $ok + " size=" + $w + "x" + $h)
