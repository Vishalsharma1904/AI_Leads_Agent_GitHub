param(
  [string]$Handle = ''
)
# Prints the URL shown in a browser window's address bar (Chrome, Edge,
# Brave, Firefox), or nothing. Uses UI Automation to READ the address box:
# no keystrokes, no clipboard, no pixels. Foreground window by default, or
# the window whose handle is passed with -Handle. One-shot, called by
# bridge.js GET /browser-url -- that's how Clavis knows what "this website"
# means when sir says "is website ke baare me batao".

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ClavisFgWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$urlPattern = '^(https?://)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?([/?#]\S*)?$'
$found = ''
try {
  $h = [ClavisFgWindow]::GetForegroundWindow()
  if ($Handle) { $h = [IntPtr]([int64]$Handle) }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
  $isEdit = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)

  # Chromium names its omnibox "Address and search bar": try that first so we
  # never have to walk the (much larger) web-page tree.
  $candidates = @()
  $byName = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Address and search bar')
  $first = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@($isEdit, $byName)))
  if ($null -ne $first) { $candidates += $first }
  if ($candidates.Count -eq 0) {
    foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isEdit)) { $candidates += $e }
  }

  foreach ($e in $candidates) {
    $pattern = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = [string]$pattern.Current.Value
      if ($value -match $urlPattern) { $found = $value; break }
    }
  }
} catch {
  $found = ''
}
[Console]::Out.Write($found)
