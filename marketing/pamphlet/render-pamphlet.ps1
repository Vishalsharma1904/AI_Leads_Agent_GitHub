# Renders rudra24-pamphlet.html -> Rudra24-AI-Pamphlet.jpg (2480x3508, A4 @ 300dpi-ish)
$ErrorActionPreference = 'Stop'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$html   = Join-Path $here 'rudra24-pamphlet.html'
$png    = Join-Path $here 'render-pamphlet.png'
$jpg    = Join-Path $here 'Rudra24-AI-Pamphlet.jpg'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$url    = 'file:///' + ($html -replace '\\','/')

$profile = Join-Path $env:TEMP 'rudra24-pamphlet-profile'
if (Test-Path $png) { Remove-Item $png }
$args = @('--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',"--user-data-dir=`"$profile`"",
  '--allow-file-access-from-files','--window-size=1240,1754','--force-device-scale-factor=2',
  '--virtual-time-budget=8000',"--screenshot=`"$png`"","`"$url`"")
Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden
Start-Sleep -Milliseconds 500
if (-not (Test-Path $png)) { throw 'Chrome screenshot failed' }

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($png)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]95)
$img.Save($jpg, $codec, $params)
"Saved $jpg  ($($img.Width)x$($img.Height))"
$img.Dispose()
Remove-Item $png
