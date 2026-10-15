param([switch]$Release)
$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $PSScriptRoot '.toolchain'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
function Get-ToolZip($Name, $Url) {
    $destination = Join-Path $toolRoot $Name
    if (!(Test-Path -LiteralPath $destination) -or (Get-Item -LiteralPath $destination).Length -eq 0) {
        Write-Host "Downloading $Name"
        & curl.exe --fail --location --silent --show-error --max-time 180 $Url --output ($destination + '.partial')
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
        Move-Item -LiteralPath ($destination + '.partial') -Destination $destination -Force
    }
    return $destination
}
if (!$env:JAVA_HOME -or !(Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
    $jdkZip = Get-ToolZip 'jdk17.zip' 'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip'
    if (!(Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'jdk-17*')) { Expand-Archive -LiteralPath $jdkZip -DestinationPath $toolRoot -Force }
    $env:JAVA_HOME = (Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
}
$gradleDir = Join-Path $toolRoot 'gradle-8.11.1'
if (!(Test-Path -LiteralPath $gradleDir)) {
    $gradleZip = Get-ToolZip 'gradle-fast.zip' 'https://downloads.gradle.org/distributions/gradle-8.11.1-bin.zip'
    Expand-Archive -LiteralPath $gradleZip -DestinationPath $toolRoot -Force
}
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolRoot 'sdk' }
$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools/latest/bin/sdkmanager.bat'
if (!(Test-Path -LiteralPath $sdkManager)) {
    $sdkZip = Get-ToolZip 'android-tools-clean.zip' 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
    $toolsTemp = Join-Path $toolRoot 'android-tools-clean'
    Expand-Archive -LiteralPath $sdkZip -DestinationPath $toolsTemp -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $env:ANDROID_HOME 'cmdline-tools') | Out-Null
    Move-Item -LiteralPath (Join-Path $toolsTemp 'cmdline-tools') -Destination (Join-Path $env:ANDROID_HOME 'cmdline-tools/latest')
}
1..40 | ForEach-Object { 'y' } | & $sdkManager --licenses | Out-Null
& $sdkManager 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK setup failed' }
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
$projectPath = Join-Path $PSScriptRoot 'android'
$taskName = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
& (Join-Path $gradleDir 'bin/gradle.bat') -p $projectPath --no-daemon --no-watch-fs $taskName
if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
Write-Host "APK in android/app/build/outputs/apk (release requires your signing key)."
