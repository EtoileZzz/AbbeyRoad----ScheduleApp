# 生成应用图标（圆角方块 + AR 字样），输出到 res/mipmap-*/ic_launcher.png
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }

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

foreach ($k in $sizes.Keys) {
    $size = $sizes[$k]
    $dir = Join-Path $root "res\mipmap-$k"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
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

    $fontSize = [int]($size * 0.40)
    $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.DrawString('AR', $font, $white, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $fmt)

    $g.Dispose()
    $bmp.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "icon -> mipmap-$k ($size)"
}
