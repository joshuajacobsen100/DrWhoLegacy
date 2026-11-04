# Builds the Android app (a debug APK) from the web game.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_apk.ps1
# Needs JDK 21 and the Android SDK (platform-tools, platforms;android-36, build-tools;36.0.0). Everything lives under
# $Tools; nothing is installed system-wide. Run it in a normal terminal: Java's NIO selectors do not start inside some
# sandboxes (Gradle needs them).
param(
  [string]$Tools = 'D:\Desktop\Software_Portable'
)
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'web'
$log = Join-Path $root 'apk_build.log'
Start-Transcript -Path $log -Force | Out-Null

$env:JAVA_HOME = Join-Path $Tools 'jdk-21'
$env:ANDROID_HOME = Join-Path $Tools 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $Tools 'gradle-home'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;" + $env:Path

function Step($text) { Write-Host ""; Write-Host "=== $text ===" }
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $what (exit $LASTEXITCODE)"; Stop-Transcript | Out-Null; exit 1 } }

Step 'Java'
& "$env:JAVA_HOME\bin\java.exe" -version; Check 'java'

Step 'Android SDK packages'
$sdkmanager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
# the names are quoted so cmd.exe does not split them at the semicolon
$need = @('platform-tools', '"platforms;android-36"', '"build-tools;36.0.0"')
$havePlatform = Test-Path (Join-Path $env:ANDROID_HOME 'platforms\android-36')
$haveTools = Test-Path (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0')
if (-not $havePlatform -or -not $haveTools) {
  & $sdkmanager "--sdk_root=$env:ANDROID_HOME" @need; Check 'sdkmanager install'
} else { Write-Host 'already installed' }
Get-ChildItem $env:ANDROID_HOME -Directory | ForEach-Object { Write-Host " sdk: $($_.Name)" }
Get-ChildItem (Join-Path $env:ANDROID_HOME 'licenses') -ErrorAction SilentlyContinue | ForEach-Object { Write-Host " licence file: $($_.Name)" }

Step 'Web build and sync'
Push-Location $web
& npm run build; Check 'npm run build'
# Windows (or a virus scanner) sometimes holds files in the copied assets open; clear the old copy ourselves, with retries
$assets = Join-Path $web 'android\app\src\main\assets\public'
for ($i = 1; $i -le 6 -and (Test-Path $assets); $i++) {
  & cmd.exe /c "rd /s /q `"$assets`"" 2>$null
  if (Test-Path $assets) { Write-Host "assets folder still busy, retry $i"; Start-Sleep -Seconds 5 }
}
& npx cap sync android; Check 'cap sync'
Pop-Location

# Gradle finds the SDK through local.properties
$sdkDir = $env:ANDROID_HOME -replace '\\', '/'
Set-Content -Path (Join-Path $web 'android\local.properties') -Value "sdk.dir=$sdkDir" -Encoding ascii

Step 'Gradle: assembleDebug'
Push-Location (Join-Path $web 'android')
& .\gradlew.bat assembleDebug --no-daemon --console=plain; Check 'gradle assembleDebug'
Pop-Location

Step 'Result'
$apk = Join-Path $web 'android\app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
  $out = Join-Path $root 'apk'
  New-Item -ItemType Directory -Force $out | Out-Null
  $dest = Join-Path $out 'doctor-who-legacy-debug.apk'
  Copy-Item $apk $dest -Force
  Write-Host ("APK: {0}  ({1:N1} MB)" -f $dest, ((Get-Item $dest).Length / 1MB))
  Write-Host 'BUILD OK'
} else {
  Write-Host 'No APK was produced.'
  Stop-Transcript | Out-Null
  exit 1
}
Stop-Transcript | Out-Null
