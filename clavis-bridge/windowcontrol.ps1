# Persistent window-management + cursor-position helper: reads ONE JSON
# action per line from stdin, executes it, writes ONE JSON result line to
# stdout. Same persistent-process shape as pccontrol.ps1 (see bridge.js
# ensureWindowControlLoop) so the Add-Type C# compile is paid once, not per
# call. Kept as its OWN process/script -- deliberately not folded into
# pccontrol.ps1 -- so a mistake here can never take down mouse/keyboard
# control, which people already rely on.
#
# Payload shape per line: { action, handle?, title? }
# action: list | minimize | maximize | restore | close | focus | cursor

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class ClavisWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

  public static List<IntPtr> ListVisible() {
    var handles = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (IsWindowVisible(hWnd) && GetWindowTextLengthW(hWnd) > 0) handles.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return handles;
  }

  public static string GetTitle(IntPtr hWnd) {
    int len = GetWindowTextLengthW(hWnd);
    if (len <= 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowTextW(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@

$SW_MINIMIZE = 6
$SW_MAXIMIZE = 3
$SW_RESTORE  = 9
$WM_CLOSE    = 0x0010

function Get-VisibleWindows {
  $result = @()
  foreach ($h in [ClavisWindows]::ListVisible()) {
    $title = [ClavisWindows]::GetTitle($h)
    if (-not $title) { continue }
    $procId = 0
    [void][ClavisWindows]::GetWindowThreadProcessId($h, [ref]$procId)
    $procName = ''
    try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = '' }
    $result += [pscustomobject]@{ handle = [int64]$h; title = $title; process = $procName }
  }
  return $result
}

function Resolve-WindowHandle($payload) {
  if ($payload.handle) {
    $h = [IntPtr]([int64]$payload.handle)
    if ([ClavisWindows]::IsWindowVisible($h)) { return $h }
    throw "That window is no longer open."
  }
  if ($payload.title) {
    $q = [string]$payload.title
    foreach ($w in (Get-VisibleWindows)) {
      if ($w.title -like "*$q*") { return [IntPtr]$w.handle }
    }
    throw "No open window matches '$q'."
  }
  throw "Need a 'handle' or 'title' to identify the window."
}

function Run-Action($payload) {
  switch ($payload.action) {
    'list' {
      return @{ windows = @(Get-VisibleWindows) }
    }
    'cursor' {
      $p = [System.Windows.Forms.Cursor]::Position
      return @{ x = $p.X; y = $p.Y }
    }
    'minimize' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_MINIMIZE)
      return $null
    }
    'maximize' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_MAXIMIZE)
      return $null
    }
    'restore' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_RESTORE)
      return $null
    }
    'focus' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_RESTORE)
      [void][ClavisWindows]::SetForegroundWindow($h)
      return $null
    }
    'close' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::PostMessage($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
      return $null
    }
    default {
      throw "Unknown window-control action: $($payload.action)"
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
    $data = Run-Action $payload
    if ($null -ne $data) {
      $data['ok'] = $true
      [Console]::Out.WriteLine(($data | ConvertTo-Json -Compress -Depth 6))
    } else {
      [Console]::Out.WriteLine('{"ok":true}')
    }
  } catch {
    $msg = $_.Exception.Message -replace '"', "'"
    [Console]::Out.WriteLine("{`"ok`":false,`"error`":`"$msg`"}")
  }
  [Console]::Out.Flush()
}
