param(
  [switch]$Loop,
  [int]$IntervalMs = 1000
)
# Reports the foreground window (title + owning process) and OS idle time as JSON.
#
# For a browser, the window title IS the active tab's title — which is how
# Clavis knows which tab/app you are on without reading your screen.
# Read-only: it never clicks, types, or captures pixels.
#
# -Loop keeps ONE process alive printing a JSON line every $IntervalMs. That
# matters: Add-Type compiles C# on first use and costs seconds, so spawning a
# fresh powershell per poll would be far too slow. The bridge starts this once
# and just caches the latest line.

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ClavisWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);

  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static uint IdleMs() {
    LASTINPUTINFO i = new LASTINPUTINFO();
    i.cbSize = (uint)Marshal.SizeOf(i);
    if (!GetLastInputInfo(ref i)) return 0;
    return (uint)Environment.TickCount - i.dwTime;
  }
}
"@

function Get-ActiveWindowInfo {
  $h = [ClavisWin]::GetForegroundWindow()
  $title = ""
  $procName = ""
  $procId = 0

  if ($h -ne [IntPtr]::Zero) {
    $len = [ClavisWin]::GetWindowTextLengthW($h)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 2)
      [void][ClavisWin]::GetWindowTextW($h, $sb, $sb.Capacity)
      $title = $sb.ToString()
    }
    [void][ClavisWin]::GetWindowThreadProcessId($h, [ref]$procId)
    if ($procId -gt 0) {
      try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = "" }
    }
  }

  $idleMs = 0
  try { $idleMs = [ClavisWin]::IdleMs() } catch { $idleMs = 0 }

  return [pscustomobject]@{
    title   = $title
    process = $procName
    pid     = $procId
    idleMs  = [int]$idleMs
  }
}

if ($Loop) {
  # Unbuffered line-per-sample stream for the bridge to consume.
  while ($true) {
    try {
      $info = Get-ActiveWindowInfo
      [Console]::Out.WriteLine(($info | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    } catch {
      [Console]::Out.WriteLine('{"title":"","process":"","pid":0,"idleMs":0}')
      [Console]::Out.Flush()
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
} else {
  Get-ActiveWindowInfo | ConvertTo-Json -Compress
}
