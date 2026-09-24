# Lists every app the Start menu knows (classic desktop apps AND Store apps
# like WhatsApp / ChatGPT) as a JSON array of { Name, AppID }. One-shot,
# read-only; bridge.js (POST /launch) caches the result and launches a match
# through shell:AppsFolder\<AppID> -- exactly what clicking it in Start does.
# No Add-Type here, so this starts in a second or two, not the 7-9s the
# C#-compiling helpers pay.

$ErrorActionPreference = 'Stop'
$apps = @()
try {
  $apps = @(Get-StartApps | Select-Object Name, AppID)
} catch {
  $apps = @()
}
[Console]::Out.Write((ConvertTo-Json -InputObject $apps -Compress -Depth 3))
