param(
  [string]$BackgroundPath = (Join-Path $PSScriptRoot '..\assets\rudra24-showcase-bg.png'),
  [string]$PngPath = (Join-Path $PSScriptRoot '..\assets\rudra24-ai-client-showcase.png'),
  [string]$JpgPath = (Join-Path $PSScriptRoot '..\assets\rudra24-ai-client-showcase.jpg')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$BackgroundPath = [System.IO.Path]::GetFullPath($BackgroundPath)
$PngPath = [System.IO.Path]::GetFullPath($PngPath)
$JpgPath = [System.IO.Path]::GetFullPath($JpgPath)

if (-not (Test-Path -LiteralPath $BackgroundPath)) {
  throw "Background image not found: $BackgroundPath"
}

$W = 2400
$H = 1350

function C([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function F([System.Drawing.Color]$color) {
  return [System.Drawing.SolidBrush]::new($color)
}

function P([System.Drawing.Color]$color, [float]$width = 1.0) {
  return [System.Drawing.Pen]::new($color, $width)
}

function Rect([float]$x, [float]$y, [float]$w, [float]$h) {
  return [System.Drawing.RectangleF]::new($x, $y, $w, $h)
}

function RoundedPath([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function FillRounded($g, [System.Drawing.RectangleF]$rect, [System.Drawing.Color]$color, [float]$radius = 18) {
  $brush = F $color
  $path = RoundedPath $rect $radius
  $g.FillPath($brush, $path)
  $path.Dispose(); $brush.Dispose()
}

function StrokeRounded($g, [System.Drawing.RectangleF]$rect, [System.Drawing.Color]$color, [float]$width = 1, [float]$radius = 18) {
  $pen = P $color $width
  $path = RoundedPath $rect $radius
  $g.DrawPath($pen, $path)
  $path.Dispose(); $pen.Dispose()
}

function DrawText($g, [string]$text, [System.Drawing.Font]$font, [System.Drawing.Color]$color, [System.Drawing.RectangleF]$rect, [System.Drawing.StringAlignment]$alignment = [System.Drawing.StringAlignment]::Near) {
  $brush = F $color
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = $alignment
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.Trimming = [System.Drawing.StringTrimming]::None
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
  $g.DrawString($text, $font, $brush, $rect, $format)
  $format.Dispose(); $brush.Dispose()
}

function DrawWrapped($g, [string]$text, [System.Drawing.Font]$font, [System.Drawing.Color]$color, [System.Drawing.RectangleF]$rect, [float]$lineSpacing = 1.15) {
  $brush = F $color
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Near
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.Trimming = [System.Drawing.StringTrimming]::Word
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
  $g.DrawString($text, $font, $brush, $rect, $format)
  $format.Dispose(); $brush.Dispose()
}

function DrawLine($g, [System.Drawing.Color]$color, [float]$width, [float]$x1, [float]$y1, [float]$x2, [float]$y2) {
  $pen = P $color $width
  $g.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}

function DrawPill($g, [string]$text, [System.Drawing.Font]$font, [System.Drawing.Color]$fill, [System.Drawing.Color]$ink, [float]$x, [float]$y, [float]$h = 34, [float]$pad = 18, [System.Drawing.Color]$border = [System.Drawing.Color]::Empty) {
  $measure = $g.MeasureString($text, $font)
  $w = [float]([Math]::Ceiling($measure.Width) + ($pad * 2))
  $rect = Rect $x $y $w $h
  FillRounded $g $rect $fill ($h / 2)
  if (-not $border.IsEmpty) { StrokeRounded $g $rect $border 1 ($h / 2) }
  DrawText $g $text $font $ink (Rect ($x + $pad) ($y + 6) ($w - ($pad * 2)) ($h - 8))
  return $w
}

function DrawIcon($g, [string]$kind, [float]$cx, [float]$cy, [float]$size, [System.Drawing.Color]$color) {
  $pen = P $color ([Math]::Max(2, $size / 12))
  $half = $size / 2
  switch ($kind) {
    'search' {
      $g.DrawEllipse($pen, $cx - $half * .7, $cy - $half * .7, $size * .9, $size * .9)
      $g.DrawLine($pen, $cx + $half * .1, $cy + $half * .1, $cx + $half * .72, $cy + $half * .72)
    }
    'grid' {
      foreach ($dx in @(-.36, .08)) { foreach ($dy in @(-.36, .08)) { $g.DrawRectangle($pen, $cx + ($size * $dx), $cy + ($size * $dy), $size * .28, $size * .28) } }
    }
    'arrow' {
      $g.DrawLine($pen, $cx - $half * .7, $cy, $cx + $half * .55, $cy)
      $g.DrawLine($pen, $cx + $half * .55, $cy, $cx + $half * .18, $cy - $half * .34)
      $g.DrawLine($pen, $cx + $half * .55, $cy, $cx + $half * .18, $cy + $half * .34)
    }
    'spark' {
      $g.DrawEllipse($pen, $cx - $half * .42, $cy - $half * .42, $size * .84, $size * .84)
      foreach ($a in @(0, 90, 180, 270)) {
        $rad = $a * [Math]::PI / 180
        $x1 = $cx + [Math]::Cos($rad) * $half * .66
        $y1 = $cy + [Math]::Sin($rad) * $half * .66
        $x2 = $cx + [Math]::Cos($rad) * $half
        $y2 = $cy + [Math]::Sin($rad) * $half
        $g.DrawLine($pen, $x1, $y1, $x2, $y2)
      }
    }
  }
  $pen.Dispose()
}

function DrawStageCard($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$number, [string]$title, [string]$icon, [System.Drawing.Color]$accent, [string[]]$lines, [string[]]$chips) {
  $card = Rect $x $y $w $h
  FillRounded $g $card (C 255 253 244 228) 26
  StrokeRounded $g $card (C 47 82 51 28) 1 26
  FillRounded $g (Rect ($x + 28) ($y + 28) 62 62) $accent 22
  DrawIcon $g $icon ($x + 59) ($y + 59) 30 (C 251 246 234)
  $numberFont = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
  $titleFont = [System.Drawing.Font]::new('Georgia', 28, [System.Drawing.FontStyle]::Regular)
  DrawText $g $number $numberFont (C 110 103 87) (Rect ($x + 114) ($y + 30) 110 24)
  DrawText $g $title $titleFont (C 28 49 30) (Rect ($x + 114) ($y + 52) ($w - 140) 42)
  $bulletFont = [System.Drawing.Font]::new('Segoe UI', 17, [System.Drawing.FontStyle]::Regular)
  $dotBrush = F $accent
  $lineY = $y + 132
  foreach ($line in $lines) {
    $g.FillEllipse($dotBrush, $x + 30, $lineY + 8, 7, 7)
    DrawText $g $line $bulletFont (C 58 61 51) (Rect ($x + 50) $lineY ($w - 78) 26)
    $lineY += 38
  }
  $chipFont = [System.Drawing.Font]::new('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
  $chipX = $x + 28
  foreach ($chip in $chips) {
    $chipW = DrawPill $g $chip $chipFont (C 231 238 225) $accent $chipX ($y + $h - 54) 30 13 (C 47 82 51 30)
    $chipX += $chipW + 8
  }
  $dotBrush.Dispose(); $bulletFont.Dispose(); $chipFont.Dispose(); $numberFont.Dispose(); $titleFont.Dispose()
}

$img = [System.Drawing.Image]::FromFile($BackgroundPath)
$bmp = [System.Drawing.Bitmap]::new($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$g.DrawImage($img, (Rect 0 0 $W $H))
$img.Dispose()

# Preserve the generated orbital field while creating a quiet reading surface.
FillRounded $g (Rect 52 98 1200 546) (C 251 246 234 190) 34
StrokeRounded $g (Rect 52 98 1200 546) (C 47 82 51 42) 1 34

$fontBrand = [System.Drawing.Font]::new('Segoe UI', 23, [System.Drawing.FontStyle]::Bold)
$fontMeta = [System.Drawing.Font]::new('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$fontKicker = [System.Drawing.Font]::new('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
$fontTitle = [System.Drawing.Font]::new('Georgia', 82, [System.Drawing.FontStyle]::Regular)
$fontSub = [System.Drawing.Font]::new('Segoe UI', 23, [System.Drawing.FontStyle]::Regular)
$fontPill = [System.Drawing.Font]::new('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$fontCallout = [System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$fontCalloutSmall = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Regular)
$fontPanelKicker = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$fontPanelTitle = [System.Drawing.Font]::new('Georgia', 31, [System.Drawing.FontStyle]::Regular)
$fontFooter = [System.Drawing.Font]::new('Segoe UI', 13, [System.Drawing.FontStyle]::Regular)

# Brand lock-up.
FillRounded $g (Rect 84 42 52 52) (C 28 49 30) 18
$logoFont = [System.Drawing.Font]::new('Georgia', 16, [System.Drawing.FontStyle]::Bold)
DrawText $g 'R24' $logoFont (C 244 236 216) (Rect 91 54 40 28) ([System.Drawing.StringAlignment]::Center)
$logoFont.Dispose()
DrawText $g 'Rudra24 AI' $fontBrand (C 28 49 30) (Rect 154 43 230 32)
DrawText $g 'B2B GROWTH WORKSPACE' $fontMeta (C 110 106 92) (Rect 156 77 270 20)

DrawText $g '01  /  PRODUCT OVERVIEW' $fontKicker (C 47 82 51) (Rect 120 150 370 28)
DrawText $g "From first search`nto first meeting." $fontTitle (C 28 49 30) (Rect 116 204 1040 210)
DrawLine $g (C 198 155 77) 4 122 435 510 435
DrawWrapped $g 'A quiet operating system for B2B growth — discover real opportunities, understand the signal, and move the right conversations forward.' $fontSub (C 58 61 51) (Rect 120 470 980 96)
$pillX = 120
foreach ($label in @('DISCOVER', 'QUALIFY', 'ACTIVATE')) {
  $pillW = DrawPill $g $label $fontPill (C 47 82 51) (C 251 246 234) $pillX 590 34 16
  $pillX += $pillW + 10
}

# Small control-tower callout over the orbital visual.
FillRounded $g (Rect 1650 56 648 174) (C 20 36 22 210) 30
StrokeRounded $g (Rect 1650 56 648 174) (C 251 246 234 80) 1 30
DrawText $g 'THE QUIET CONTROL LAYER' $fontCallout (C 251 246 234) (Rect 1690 83 460 30)
DrawText $g 'AI assistant  ·  data  ·  action' $fontCalloutSmall (C 231 238 225) (Rect 1690 123 470 26)
DrawText $g 'Memory, voice, scripts — with the human in control.' $fontCalloutSmall (C 231 238 225) (Rect 1690 160 530 26)

$badgeFont = [System.Drawing.Font]::new('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
DrawPill $g 'REAL SIGNALS  /  HUMAN DECISIONS' $badgeFont (C 251 246 234 50) (C 251 246 234) 1685 254 32 15 (C 251 246 234 130) | Out-Null
$badgeFont.Dispose()

# Main story panel.
FillRounded $g (Rect 74 706 2252 570) (C 251 246 234 238) 38
StrokeRounded $g (Rect 74 706 2252 570) (C 47 82 51 60) 1 38
DrawText $g 'ONE WORKSPACE. EVERY MOVE.' $fontPanelKicker (C 47 82 51) (Rect 132 744 500 24)
DrawText $g 'From intent to outcome.' $fontPanelTitle (C 28 49 30) (Rect 132 775 600 42)
$fontPanelSub = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Regular)
DrawText $g 'Three clear stages. One calm operating rhythm.' $fontPanelSub (C 110 106 92) (Rect 133 820 650 24)
$fontPanelSub.Dispose()

$stageFont = [System.Drawing.Font]::new('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
DrawPill $g 'RUDRA24 AI STUDIO' $stageFont (C 231 238 225) (C 47 82 51) 1970 748 34 16 (C 47 82 51 45) | Out-Null
$stageFont.Dispose()

DrawStageCard $g 132 865 672 286 '01' 'Discover' 'search' (C 47 82 51) @(
  'Ask in natural language',
  'Real companies + exact locations',
  'Count-aware, duplicate-safe discovery'
) @('Client AI', 'Run Agent')

DrawStageCard $g 864 865 672 286 '02' 'Organise' 'grid' (C 79 117 83) @(
  'Lead + Candidate databases',
  'Official-site contact enrichment',
  'Fit scores, analytics & exports'
) @('Excel / CSV', 'Sheets')

DrawStageCard $g 1596 865 672 286 '03' 'Activate' 'arrow' (C 160 127 72) @(
  'CRM pipeline + follow-ups',
  'Email, WhatsApp & calling queues',
  'Human confirmation at every action'
) @('Email', 'WhatsApp', 'Voice')

# Module rail: compactly names the rest of the product without turning the page into a catalogue.
DrawLine $g (C 47 82 51 55) 1 132 1182 2264 1182
DrawText $g 'INSIDE THE WORKSPACE' $fontMeta (C 110 106 92) (Rect 132 1200 240 22)
$railFont = [System.Drawing.Font]::new('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$railX = 390
foreach ($label in @('Rudra24 AI memory', 'Voice Agent Studio', 'Candidate AI', 'CRM', 'Analytics', 'Connectors', 'Plugins', 'API health')) {
  $railW = DrawPill $g $label $railFont (C 231 238 225) (C 47 82 51) $railX 1194 32 13 (C 47 82 51 32)
  $railX += $railW + 8
}
$railFont.Dispose()

# Footer note; calm, specific, and intentionally small.
DrawText $g 'Built for security, housekeeping & service teams  ·  browser-first  ·  preview → confirm → export' $fontFooter (C 251 246 234) (Rect 92 1302 1500 22)
DrawText $g 'RUDRA24 DIGITAL' $fontFooter (C 251 246 234) (Rect 2080 1302 230 22) ([System.Drawing.StringAlignment]::Far)

$fontBrand.Dispose(); $fontMeta.Dispose(); $fontKicker.Dispose(); $fontTitle.Dispose(); $fontSub.Dispose(); $fontPill.Dispose(); $fontCallout.Dispose(); $fontCalloutSmall.Dispose(); $fontPanelKicker.Dispose(); $fontPanelTitle.Dispose(); $fontFooter.Dispose()

$pngDir = Split-Path -Parent $PngPath
$jpgDir = Split-Path -Parent $JpgPath
New-Item -ItemType Directory -Force -Path $pngDir, $jpgDir | Out-Null
$bmp.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$encoder = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoder.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]97)
$bmp.Save($JpgPath, $jpegCodec, $encoder)
$encoder.Dispose(); $bmp.Dispose(); $g.Dispose()

Write-Output "Created: $PngPath"
Write-Output "Created: $JpgPath"
