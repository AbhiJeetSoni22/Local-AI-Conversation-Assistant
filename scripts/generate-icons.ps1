# Generate premium application icons for Local AI Conversation Assistant
Add-Type -AssemblyName System.Drawing

$buildDir = Join-Path $PSScriptRoot "..\build"
if (-not (Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}

function Create-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 256.0

    # Background rounded rectangle
    $margin = 14.0 * $scale
    $rectSize = 256.0 * $scale - (2 * $margin)
    $radius = 48.0 * $scale

    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bgPath.AddArc($margin, $margin, $radius * 2, $radius * 2, 180, 90)
    $bgPath.AddArc($margin + $rectSize - $radius * 2, $margin, $radius * 2, $radius * 2, 270, 90)
    $bgPath.AddArc($margin + $rectSize - $radius * 2, $margin + $rectSize - $radius * 2, $radius * 2, $radius * 2, 0, 90)
    $bgPath.AddArc($margin, $margin + $rectSize - $radius * 2, $radius * 2, $radius * 2, 90, 90)
    $bgPath.CloseFigure()

    # Dark gradient background
    $rectF = New-Object System.Drawing.RectangleF($margin, $margin, $rectSize, $rectSize)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rectF,
        [System.Drawing.Color]::FromArgb(255, 18, 20, 29),
        [System.Drawing.Color]::FromArgb(255, 10, 11, 15),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
    )
    $g.FillPath($bgBrush, $bgPath)
    $bgBrush.Dispose()

    # Glowing subtle border
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 99, 102, 241), [Math]::Max(1.0, 2.0 * $scale))
    $g.DrawPath($borderPen, $bgPath)
    $borderPen.Dispose()
    $bgPath.Dispose()

    # Draw Audio Waveform + Intelligence Spark bars
    # 7 bars representing audio speech input transitioning into assistant response
    $barHeights = @(36.0, 68.0, 104.0, 140.0, 110.0, 72.0, 42.0)
    $barWidth = 14.0 * $scale
    $gap = 10.0 * $scale
    $totalWidth = (7 * $barWidth) + (6 * $gap)
    $startX = ($size - $totalWidth) / 2.0
    $centerY = $size / 2.0

    # Color gradient across bars: Cyan (#38bdf8) -> Indigo (#6366f1) -> Violet (#8b5cf6)
    $colors = @(
        [System.Drawing.Color]::FromArgb(255, 56, 189, 248),
        [System.Drawing.Color]::FromArgb(255, 79, 163, 248),
        [System.Drawing.Color]::FromArgb(255, 99, 102, 241),
        [System.Drawing.Color]::FromArgb(255, 129, 140, 248),
        [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
        [System.Drawing.Color]::FromArgb(255, 168, 85, 247),
        [System.Drawing.Color]::FromArgb(255, 192, 132, 252)
    )

    for ($i = 0; $i -lt 7; $i++) {
        $bh = $barHeights[$i] * $scale
        $bx = $startX + $i * ($barWidth + $gap)
        $by = $centerY - ($bh / 2.0)
        $bradius = [Math]::Min($barWidth / 2.0, 6.0 * $scale)

        $barPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $barPath.AddArc($bx, $by, $bradius * 2, $bradius * 2, 180, 90)
        $barPath.AddArc($bx + $barWidth - $bradius * 2, $by, $bradius * 2, $bradius * 2, 270, 90)
        $barPath.AddArc($bx + $barWidth - $bradius * 2, $by + $bh - $bradius * 2, $bradius * 2, $bradius * 2, 0, 90)
        $barPath.AddArc($bx, $by + $bh - $bradius * 2, $bradius * 2, $bradius * 2, 90, 90)
        $barPath.CloseFigure()

        $barBrush = New-Object System.Drawing.SolidBrush($colors[$i])
        $g.FillPath($barBrush, $barPath)
        $barBrush.Dispose()
        $barPath.Dispose()
    }

    $g.Dispose()
    return $bmp
}

# Generate 256x256 PNG master
$masterBmp = Create-IconBitmap 256
$pngPath = Join-Path $buildDir "icon.png"
$masterBmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created: $pngPath"

# Also copy icon.png to public for renderer index.html favicon
$publicDir = Join-Path $PSScriptRoot "..\public"
if (-not (Test-Path $publicDir)) {
    New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
}
$publicPng = Join-Path $publicDir "icon.png"
Copy-Item -Path $pngPath -Destination $publicPng -Force
Write-Host "Copied favicon to: $publicPng"

# Generate multi-resolution ICO file
$sizes = @(256, 128, 64, 48, 32, 16)
$pngDataList = @()

foreach ($sz in $sizes) {
    if ($sz -eq 256) {
        $bmp = $masterBmp
    } else {
        $bmp = Create-IconBitmap $sz
    }
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $ms.Dispose()
    if ($sz -ne 256) { $bmp.Dispose() }
    $pngDataList += ,@($sz, $pngBytes)
}
$masterBmp.Dispose()

$icoPath = Join-Path $buildDir "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header (6 bytes)
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # 1 = Icon
$bw.Write([uint16]$pngDataList.Count) # Image count

# First image data offset begins after header and all directory entries
# Header: 6 bytes + (16 bytes * count)
$offset = 6 + (16 * $pngDataList.Count)

foreach ($item in $pngDataList) {
    $sz = $item[0]
    $data = $item[1]
    $w = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $h = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }

    $bw.Write($w)               # Width
    $bw.Write($h)               # Height
    $bw.Write([byte]0)          # Colors
    $bw.Write([byte]0)          # Reserved
    $bw.Write([uint16]1)        # Color planes
    $bw.Write([uint16]32)       # Bits per pixel
    $bw.Write([uint32]$data.Length) # Image byte size
    $bw.Write([uint32]$offset)  # Image offset

    $offset += $data.Length
}

foreach ($item in $pngDataList) {
    $data = $item[1]
    $bw.Write($data)
}

$bw.Flush()
$fs.Dispose()

Write-Host "Created multi-resolution icon: $icoPath (containing sizes: $($sizes -join ', '))"

