# Real virtual-screen bounds (can start at negative x/y when a monitor sits
# left of/above the primary one). Pure .NET, matches screenshot.ps1's capture area.
Add-Type -AssemblyName System.Windows.Forms
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
Write-Output "$($vs.Left),$($vs.Top),$($vs.Width),$($vs.Height)"
