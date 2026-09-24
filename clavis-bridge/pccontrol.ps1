# Persistent mouse/keyboard control server: reads ONE JSON action per line
# from stdin, executes it, writes ONE JSON result line to stdout. Kept alive
# by the bridge (see bridge.js ensurePcControlLoop) so the Add-Type C# compile
# below — measured at several seconds on a cold spawn — is paid exactly once,
# not on every single click/type/key action.
#
# Payload shape per line: { action, x, y, x2, y2, button, double, text, keys, amount }
# action: move | click | scroll | drag | type | key

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ClavisMouse {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$MOUSEEVENTF_LEFTDOWN   = 0x0002
$MOUSEEVENTF_LEFTUP     = 0x0004
$MOUSEEVENTF_RIGHTDOWN  = 0x0008
$MOUSEEVENTF_RIGHTUP    = 0x0010
$MOUSEEVENTF_MIDDLEDOWN = 0x0020
$MOUSEEVENTF_MIDDLEUP   = 0x0040
$MOUSEEVENTF_WHEEL      = 0x0800

function Move-To([int]$x, [int]$y) {
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
}

function Click-Button([string]$button) {
  switch ($button) {
    'right'  { [ClavisMouse]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 35; [ClavisMouse]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero) }
    'middle' { [ClavisMouse]::mouse_event($MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 35; [ClavisMouse]::mouse_event($MOUSEEVENTF_MIDDLEUP, 0, 0, 0, [UIntPtr]::Zero) }
    default  { [ClavisMouse]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 35; [ClavisMouse]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero) }
  }
}

# SendKeys reserves + ^ % ~ ( ) { } [ ] as modifiers/grouping — wrap each in
# braces so literal typed text (which can contain any of these) isn't
# misread as a keyboard shortcut.
function Escape-Literal([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    if ('+^%~(){}[]' -contains $ch) { [void]$sb.Append('{').Append($ch).Append('}') }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}

function Run-Action($payload) {
  switch ($payload.action) {
    'move' {
      Move-To $payload.x $payload.y
    }
    'click' {
      Move-To $payload.x $payload.y
      Start-Sleep -Milliseconds 40
      Click-Button $payload.button
      if ($payload.double) { Start-Sleep -Milliseconds 60; Click-Button $payload.button }
    }
    'scroll' {
      if ($null -ne $payload.x -and $null -ne $payload.y) { Move-To $payload.x $payload.y }
      [ClavisMouse]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, [uint32]([int]$payload.amount * 120), [UIntPtr]::Zero)
    }
    'drag' {
      Move-To $payload.x $payload.y
      Start-Sleep -Milliseconds 60
      [ClavisMouse]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      $steps = 12
      for ($i = 1; $i -le $steps; $i++) {
        $ix = [int]($payload.x + ($payload.x2 - $payload.x) * $i / $steps)
        $iy = [int]($payload.y + ($payload.y2 - $payload.y) * $i / $steps)
        Move-To $ix $iy
        Start-Sleep -Milliseconds 12
      }
      Start-Sleep -Milliseconds 40
      [ClavisMouse]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
    'type' {
      [System.Windows.Forms.SendKeys]::SendWait((Escape-Literal([string]$payload.text)))
    }
    'key' {
      [System.Windows.Forms.SendKeys]::SendWait([string]$payload.keys)
    }
    default {
      throw "Unknown pc-control action: $($payload.action)"
    }
  }
}

# Tell the bridge we're ready to receive commands (Add-Type above is done).
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break } # stdin closed = bridge shutting us down
  if (-not $line.Trim()) { continue }
  try {
    $payload = $line | ConvertFrom-Json
    Run-Action $payload
    [Console]::Out.WriteLine('{"ok":true}')
  } catch {
    $msg = $_.Exception.Message -replace '"', "'"
    [Console]::Out.WriteLine("{`"ok`":false,`"error`":`"$msg`"}")
  }
  [Console]::Out.Flush()
}
