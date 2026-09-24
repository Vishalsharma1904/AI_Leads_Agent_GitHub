param(
  [Parameter(Mandatory=$true)][string]$Out,
  [switch]$Clipboard
)
# Full virtual-screen capture (all monitors) -> PNG. Pure .NET, no deps.
# -Clipboard also puts the image on the Windows clipboard. The bridge deletes
# $Out immediately after reading it, so the only lasting copy is the clipboard.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$vs  = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.Location, [System.Drawing.Point]::Empty, $vs.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

if ($Clipboard) {
  # Clipboard.SetImage requires an STA thread. A PowerShell ScriptBlock cannot
  # run on a bare .NET thread (no runspace), so hand the copy to a short-lived
  # -STA child process instead. SetImage flushes with copy:true, so the image
  # survives that child exiting.
  $escaped = $Out.Replace("'", "''")
  $code = @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
`$img = [System.Drawing.Image]::FromFile('$escaped')
[System.Windows.Forms.Clipboard]::SetImage(`$img)
`$img.Dispose()
"@
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -STA -Command $code | Out-Null
  } catch {
    Write-Error "Clipboard copy failed: $($_.Exception.Message)"
  }
}
