# Abbey Road · 应用图标生成（Android mipmap + Windows ICO）
# 设计：蓝色圆角底 + 白色课表卡片 + 彩色课程格 —— 一眼看出是"课表"
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent

function New-Rounded([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    if ($d -le 0) { $d = 0.1 }
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)

    # ① 圆角渐变底
    $bg = New-Rounded 0 0 $size $size ($size * 0.23)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
        ([System.Drawing.Color]::FromArgb(255, 76, 126, 235)),
        ([System.Drawing.Color]::FromArgb(255, 136, 178, 250)), 55
    $g.FillPath($grad, $bg)

    # ② 白色课表卡片
    $pad = $size * 0.155
    $cardW = $size - $pad * 2
    $cardH = $cardW * 1.02
    $cardX = $pad
    $cardY = ($size - $cardH) / 2
    $card = New-Rounded $cardX $cardY $cardW $cardH ($size * 0.075)
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillPath($white, $card)

    $g.SetClip($card)
    # 卡片顶栏
    $barH = $cardH * 0.19
    $barColor = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 238, 250))
    $g.FillRectangle($barColor, $cardX, $cardY, $cardW, $barH)
    if ($size -ge 48) {
        $dotR = [single]($size * 0.026)
        $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 158, 178, 214))
        for ($i = 0; $i -lt 3; $i++) {
            $cx = $cardX + $cardW * (0.16 + 0.16 * $i)
            $cy = $cardY + $barH * 0.5
            $g.FillEllipse($dotBrush, $cx - $dotR, $cy - $dotR, $dotR * 2, $dotR * 2)
        }
    }

    # ③ 课程格：3 列 × 4 行，几格上色
    $cols = 3; $rows = 4
    $gap = $size * 0.024
    $gridTop = $cardY + $barH + $gap
    $cellW = ($cardW - $gap * ($cols + 1)) / $cols
    $cellH = ($cardY + $cardH - $gridTop - $gap * ($rows + 1)) / $rows
    $empty = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 226, 232, 242))
    $fills = @{
        '0_0' = [System.Drawing.Color]::FromArgb(255, 91, 141, 239)
        '1_0' = [System.Drawing.Color]::FromArgb(255, 232, 132, 60)
        '0_1' = [System.Drawing.Color]::FromArgb(255, 124, 110, 230)
        '2_2' = [System.Drawing.Color]::FromArgb(255, 47, 179, 122)
        '1_3' = [System.Drawing.Color]::FromArgb(255, 91, 141, 239)
    }
    for ($r = 0; $r -lt $rows; $r++) {
        for ($c = 0; $c -lt $cols; $c++) {
            $x = $cardX + $gap + $c * ($cellW + $gap)
            $y = $gridTop + $gap + $r * ($cellH + $gap)
            $cell = New-Rounded $x $y $cellW $cellH ($size * 0.028)
            $key = "${c}_${r}"
            if ($fills.ContainsKey($key)) {
                $b = New-Object System.Drawing.SolidBrush $fills[$key]
            } else {
                $b = $empty
            }
            $g.FillPath($b, $cell)
            $cell.Dispose()
        }
    }

    $g.ResetClip()
    $g.Dispose()
    return $bmp
}

# ── Android mipmap ──────────────────────────────────────────────
$densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($k in $densities.Keys) {
    $size = $densities[$k]
    $dir = Join-Path $root "android\res\mipmap-$k"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $bmp = New-IconBitmap $size
    $bmp.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "android -> mipmap-$k ($size)"
}

# ── Windows ICO（多尺寸 PNG 帧） ─────────────────────────────────
function Get-PngBytes([int]$size) {
    $bmp = New-IconBitmap $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$sizes = @(256, 64, 32, 16)
$frames = @()
foreach ($s in $sizes) { $frames += , (Get-PngBytes $s) }

$assets = Join-Path $root 'windows\assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$icoPath = Join-Path $assets 'abbeyroad.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    [byte[]]$bytes = $frames[$i]
    [byte]$dim = 0
    if ($s -lt 256) { $dim = [byte]$s }
    $bw.Write($dim); $bw.Write($dim)
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$bytes.Length); $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
}
foreach ($bytes in $frames) { $bw.Write($bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()
Write-Host "windows -> $icoPath ($((Get-Item $icoPath).Length) bytes)"
