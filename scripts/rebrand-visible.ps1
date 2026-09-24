# ============================================================
#  One-off rebrand pass: VISIBLE strings + source header comments only.
#
#  DELIBERATELY NOT TOUCHED:
#   - localStorage / sessionStorage keys  (skylark_* , skylark-*)
#   - IndexedDB database names            (skylark_agent_db_*)
#   - custom DOM event names              (skylark:themechange, ...)
#   - the window.SKYLARK_CONFIG global
#  Renaming any of those would orphan every existing user's leads,
#  credits, chats and settings. They are never shown in the UI.
# ============================================================

$ErrorActionPreference = 'Stop'

# Exact literal find -> replace pairs. Order matters: longest first.
$pairs = [ordered]@{
    'SKYLARK SHORTCUTS HUB'                    = 'NEXUS AI SHORTCUTS HUB'
    'SKYLARK EMAIL AUTOMATION'                 = 'NEXUS AI EMAIL AUTOMATION'
    'SKYLARK LEAD AGENT'                       = 'NEXUS AI LEAD AGENT'
    'SKYLARK SMOOTH SCROLL'                    = 'NEXUS AI SMOOTH SCROLL'
    'SKYLARK — Memory Engine'                  = 'NEXUS AI — Memory Engine'
    'SKYLARK — macOS Sequoia'                  = 'NEXUS AI — macOS Sequoia'
    'Skylark Email Webhook'                    = 'Nexus AI Email Webhook'
    'Paste in Skylark app'                     = 'Paste in the app'
    'Paste the URL into Skylark'               = 'Paste the URL into the app'
    '(Test) Skylark Email'                     = '(Test) Email'
    'https://skylarkservices.in/brochure.pdf'  = ''
    'Data Persistence Test - Skylark AI'       = 'Data Persistence Test'
    'Skylark AI Lead Agent'                    = 'Nexus AI Lead Agent'
    'Skylark AI Leads Agent'                   = 'Nexus AI Leads Agent'
    'Skylark AI'                               = 'Nexus AI'
}

$targets = Get-ChildItem -Recurse -Include *.js, *.html, *.css, *.json, *.md -File |
    Where-Object {
        $_.FullName -notmatch 'node_modules|unzip_|temp_extract|temp_redesign|\\\.agents\\|\\\.venv\\|frontend\\dist|AndroidApp|package-lock\.json|\\scripts\\rebrand-visible\.ps1'
    }

$changedFiles = 0
$changedCount = 0

foreach ($file in $targets) {
    $original = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
    if ($null -eq $original) { continue }

    $updated = $original
    foreach ($key in $pairs.Keys) {
        if ($updated.Contains($key)) {
            $occurrences = ([regex]::Matches($updated, [regex]::Escape($key))).Count
            $updated = $updated.Replace($key, $pairs[$key])
            $changedCount += $occurrences
        }
    }

    if ($updated -ne $original) {
        # UTF8Encoding($false) => no byte-order mark. Set-Content -Encoding UTF8
        # on PowerShell 5 writes a BOM, which makes JSON.parse fail on
        # manifest.json / package.json. Write the bytes ourselves instead.
        [System.IO.File]::WriteAllText($file.FullName, $updated, (New-Object System.Text.UTF8Encoding($false)))
        $changedFiles++
        Write-Host ("updated: " + $file.FullName.Replace($PWD.Path + '\', ''))
    }
}

Write-Host ""
Write-Host ("Files changed:       " + $changedFiles)
Write-Host ("Replacements made:   " + $changedCount)
