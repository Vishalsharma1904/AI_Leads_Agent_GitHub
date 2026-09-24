# Clavis static server - PowerShell fallback (Node.js na mile tab).
# serve-clavis.js jaisa hi kaam: http://localhost:3000, dotfiles / backend /
# logs kabhi serve nahi hote. Start-Clavis.bat isse sirf tab chalata hai jab
# node.exe nahi milta.
param([int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\') + '\'

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'
  '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'; '.ogg' = 'audio/ogg'; '.mp4' = 'video/mp4'
  '.wasm' = 'application/wasm'; '.txt' = 'text/plain; charset=utf-8'; '.map' = 'application/json'
}
$blocked = '(^|/)\.|^/(backend|migrations|logs|voice)/'

function New-Listener([string[]]$prefixes) {
  $l = New-Object System.Net.HttpListener
  foreach ($p in $prefixes) { $l.Prefixes.Add($p) }
  $l.Start()
  return $l
}

try {
  $listener = New-Listener @("http://localhost:$Port/", "http://127.0.0.1:$Port/")
} catch {
  # 127.0.0.1 prefix ko kabhi-kabhi admin chahiye - sirf localhost kaafi hai.
  $listener = New-Listener @("http://localhost:$Port/")
}
Write-Output "Clavis UI (PowerShell) -> http://localhost:$Port"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $file = $null
    if ($path -notmatch $blocked) {
      $candidate = [IO.Path]::GetFullPath($root + ($path.TrimStart('/') -replace '/', '\'))
      if ($candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($candidate)) {
        $file = $candidate
      }
    }
    if (-not $file) {
      $res.StatusCode = 404
      $res.Close()
      continue
    }
    $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $res.Headers['Cache-Control'] = 'no-cache'
    $bytes = [IO.File]::ReadAllBytes($file)
    $res.ContentLength64 = $bytes.Length
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    $res.Close()
  } catch {
    try { $res.Abort() } catch {}
  }
}
