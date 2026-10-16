# 生成 Windows 应用图标（多尺寸 ICO，PNG 帧），输出到 windows/assets/abbeyroad.ico
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

function New-RoundedPath([int]$w, [int]$h, [int]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc(0, 0, $d, $d, 180, 90)
    $p.AddArc($w - $d - 1, 0, $d, $d, 270, 90)
    $p.AddArc($w - $d - 1, $h - $d - 1, $d, $d, 0, 90)
    $p.AddArc(0, $h - $d - 1, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-PngBytes([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $path = New-RoundedPath $size $size ([int]($size * 0.22))
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
        ([System.Drawing.Color]::FromArgb(255, 91, 141, 239)),
        ([System.Drawing.Color]::FromArgb(255, 122, 165, 246)), 45
    $g.FillPath($brush, $path)

    $font = New-Object System.Drawing.Font 'Segoe UI', ([int]($size * 0.40)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.DrawString('AR', $font, $white, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $fmt)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return ,$ms.ToArray()
}

$sizes = @(256, 64, 32, 16)
$frames = @()
foreach ($s in $sizes) { $frames += ,(New-PngBytes $s) }

$icoPath = Join-Path $assets 'abbeyroad.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type = icon
$bw.Write([UInt16]$sizes.Count)      # count

$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    [byte[]]$bytes = $frames[$i]
    [byte]$dim = 0
    if ($s -lt 256) { $dim = [byte]$s }
    $bw.Write($dim)                                        # width (0 = 256)
    $bw.Write($dim)                                        # height
    $bw.Write([byte]0)               # palette
    $bw.Write([byte]0)               # reserved
    $bw.Write([UInt16]1)             # planes
    $bw.Write([UInt16]32)            # bpp
    $bw.Write([UInt32]$bytes.Length) # size
    $bw.Write([UInt32]$offset)       # offset
    $offset += $bytes.Length
}
foreach ($bytes in $frames) { $bw.Write($bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Host "icon -> $icoPath ($((Get-Item $icoPath).Length) bytes)"
